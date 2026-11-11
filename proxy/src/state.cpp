#include "aegis/state.hpp"
#include <algorithm>
#include <ctime>
#include <iomanip>
#include <random>
#include <sstream>
#include <stdexcept>

namespace aegis {
std::string utcNow() {
    auto now = std::chrono::system_clock::now();
    auto value = std::chrono::system_clock::to_time_t(now);
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &value);
#else
    gmtime_r(&value, &tm);
#endif
    std::ostringstream out;
    out << std::put_time(&tm, "%Y-%m-%dT%H:%M:%SZ");
    return out.str();
}
State::State(Config value, std::string secret)
    : config(std::move(value)), token(std::move(secret)) {
    if (token.size() < 32 || token.size() > 256)
        throw std::runtime_error("AEGIS_PROXY_TOKEN must contain 32 to 256 characters");
    std::random_device random;
    std::ostringstream id;
    id << std::hex << random() << random() << random() << random();
    epoch = id.str();
}
void State::emit(const std::string &type, json::object fields) {
    fields["sequence"] = ++sequence;
    fields["id"] = epoch + ":" + std::to_string(sequence);
    fields["time"] = utcNow();
    fields["type"] = type;
    fields["epoch"] = epoch;
    if (events.size() >= 2048)
        events.pop_front();
    events.push_back(std::move(fields));
}
void State::expire() {
    auto now = Clock::now();
    for (auto it = rules.begin(); it != rules.end();) {
        if (it->second.expires <= now) {
            emit("rule.expired", {{"source", it->first}, {"actionId", it->second.actionId}});
            it = rules.erase(it);
            ++revision;
        } else
            ++it;
    }
    for (auto it = buckets.begin(); it != buckets.end();) {
        if (now - it->second.updated > std::chrono::minutes(5))
            it = buckets.erase(it);
        else
            ++it;
    }
}
unsigned State::admit(const std::string &source) {
    expire();
    ++total;
    const auto ip = parseIPv4(source);
    auto now = Clock::now();
    const bool blocked = rules.count(source) || config.deny.match(ip) ||
                         (config.hasAllow && !config.allow.match(ip));
    if (!buckets.count(ip) && buckets.size() >= 4096) {
        ++limited;
        emit("request.completed",
             {{"source", source}, {"status", 429}, {"reason", "client_capacity"}});
        return 429;
    }
    auto [it, inserted] = buckets.try_emplace(ip);
    auto &b = it->second;
    if (inserted) {
        b.tokens = config.burst;
        b.updated = now;
        b.window = now;
    }
    b.tokens = std::min(double(config.burst),
                        b.tokens + std::chrono::duration<double>(now - b.updated).count() *
                                       config.ratePerSecond);
    b.updated = now;
    unsigned status = 0;
    if (blocked) {
        ++denied;
        status = 403;
    } else if (b.tokens < 1) {
        ++limited;
        status = 429;
    } else
        --b.tokens;
    if (status) {
        emit("request.completed", {{"source", source},
                                   {"status", status},
                                   {"reason", blocked ? "source_denied" : "rate_limited"}});
        if (now - b.window > std::chrono::milliseconds(config.violationWindowMs)) {
            b.window = now;
            b.violations = 0;
        }
        ++b.violations;
        if (b.violations >= config.violationThreshold &&
            (b.lastIncident == Clock::time_point{} ||
             now - b.lastIncident >= std::chrono::seconds(30))) {
            emit("detection.security",
                 {{"source", source},
                  {"violations", b.violations},
                  {"windowMs", config.violationWindowMs},
                  {"reason", blocked ? "repeated_denial" : "rate_limit_burst"}});
            b.lastIncident = now;
        }
    }
    return status;
}
std::optional<std::size_t> State::selectBackend() {
    const auto count = config.backends.size();
    for (std::size_t attempt = 0; attempt < count; ++attempt) {
        const auto index = (nextBackend + attempt) % count;
        if (config.backends[index].healthy) {
            nextBackend = (index + 1) % count;
            ++config.backends[index].requests;
            return index;
        }
    }
    return std::nullopt;
}
json::object State::snapshot() {
    expire();
    json::array backends, activeRules, log, actions;
    for (const auto &b : config.backends)
        backends.push_back({{"id", b.id},
                            {"healthy", b.healthy},
                            {"requests", b.requests},
                            {"failures", b.failures},
                            {"successes", b.successes}});
    for (const auto &[source, r] : rules)
        activeRules.push_back(
            {{"source", source}, {"actionId", r.actionId}, {"expiresAtMs", r.expiresAtMs}});
    for (const auto &event : events)
        log.push_back(event);
    for (const auto &[id, a] : applied)
        actions.push_back(a.at("result"));
    return {{"epoch", epoch},
            {"revision", revision},
            {"observedAt", utcNow()},
            {"sequence", sequence},
            {"oldestSequence", events.empty()
                                   ? sequence
                                   : json::value_to<std::uint64_t>(events.front().at("sequence"))},
            {"metrics",
             {{"requests", total},
              {"forwarded", forwarded},
              {"denied", denied},
              {"limited", limited},
              {"errors", errors},
              {"connections", connections}}},
            {"limits",
             {{"ratePerSecond", config.ratePerSecond},
              {"burst", config.burst},
              {"maxConnections", config.maxConnections}}},
            {"backends", backends},
            {"rules", activeRules},
            {"events", log},
            {"actions", actions}};
}
json::object State::apply(const json::object &input) {
    expire();
    if (input.size() != 6)
        throw std::invalid_argument("unexpected action fields");
    const auto id = std::string(input.at("actionId").as_string()),
               source = std::string(input.at("source").as_string());
    const auto hash = std::string(input.at("proposalHash").as_string());
    const auto ttl = input.at("ttlSeconds").as_int64();
    if (id.size() != 36 || id.find_first_not_of("0123456789abcdef-") != std::string::npos ||
        hash.size() != 64 || hash.find_first_not_of("0123456789abcdef") != std::string::npos)
        throw std::invalid_argument("invalid action identity");
    if (auto it = applied.find(id); it != applied.end()) {
        if (it->second.at("input") != input)
            throw std::invalid_argument("action ID reused with altered parameters");
        return it->second.at("result").as_object();
    }
    if (std::string(input.at("expectedEpoch").as_string()) != epoch ||
        json::value_to<std::uint64_t>(input.at("expectedRevision")) != revision)
        throw std::invalid_argument("stale configuration version");
    auto ip = parseIPv4(source);
    if (formatIPv4(ip) != source || !config.eligible.match(ip) || config.protectedSources.match(ip))
        throw std::invalid_argument("source outside the permitted action scope");
    for (const auto &b : config.backends)
        if (b.host == source)
            throw std::invalid_argument("cannot deny a backend address");
    if (ttl < 60 || ttl > 600 || rules.count(source) || rules.size() >= 64 ||
        applied.size() >= 1024)
        throw std::invalid_argument("action bounds or capacity exceeded");
    auto expiry = std::chrono::system_clock::now() + std::chrono::seconds(ttl);
    auto ms = static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(expiry.time_since_epoch()).count());
    rules.emplace(source, Rule{id, source, ms, Clock::now() + std::chrono::seconds(ttl)});
    ++revision;
    json::object result = {{"actionId", id}, {"source", source},     {"expiresAtMs", ms},
                           {"epoch", epoch}, {"revision", revision}, {"status", "applied"}};
    applied.emplace(id, json::object{{"input", input}, {"result", result}});
    emit("rule.applied",
         {{"source", source}, {"actionId", id}, {"proposalHash", hash}, {"expiresAtMs", ms}});
    return result;
}
} // namespace aegis
