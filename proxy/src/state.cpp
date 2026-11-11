#include "aegis/state.hpp"
#include <algorithm>
#include <ctime>
#include <iomanip>
#include <random>
#include <sstream>
#include <stdexcept>

namespace aegis {
std::string utcNow() {
    auto now=std::chrono::system_clock::now(); auto value=std::chrono::system_clock::to_time_t(now);
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm,&value);
#else
    gmtime_r(&value,&tm);
#endif
    std::ostringstream out; out<<std::put_time(&tm,"%Y-%m-%dT%H:%M:%SZ"); return out.str();
}
State::State(Config value,std::string secret):config(std::move(value)),token(std::move(secret)) {
    if(token.size()<32||token.size()>256) throw std::runtime_error("AEGIS_PROXY_TOKEN must contain 32 to 256 characters");
    std::random_device random; std::ostringstream id; id<<std::hex<<random()<<random()<<random()<<random(); epoch=id.str();
}
void State::emit(const std::string& type,json::object fields) {
    fields["sequence"]=++sequence; fields["id"]=epoch+":"+std::to_string(sequence);
    fields["time"]=utcNow(); fields["type"]=type; fields["epoch"]=epoch;
    if(events.size()>=2048) events.pop_front();
    events.push_back(std::move(fields));
}
void State::expire() {
    auto now=Clock::now();
    for(auto it=rules.begin();it!=rules.end();) {
        if(it->second.expires<=now) {emit("rule.expired",{{"source",it->first},{"actionId",it->second.actionId}}); it=rules.erase(it); ++revision;}
        else ++it;
    }
    for(auto it=buckets.begin();it!=buckets.end();) {
        if(now-it->second.updated>std::chrono::minutes(5)) it=buckets.erase(it); else ++it;
    }
}
unsigned State::admit(const std::string& source) {
    expire(); ++total; const auto ip=parseIPv4(source); auto now=Clock::now();
    const bool blocked=rules.count(source)||config.deny.match(ip)||(config.hasAllow&&!config.allow.match(ip));
    if(!buckets.count(ip)&&buckets.size()>=4096) {++limited; emit("request.completed",{{"source",source},{"status",429},{"reason","client_capacity"}}); return 429;}
    auto [it,inserted]=buckets.try_emplace(ip);
    auto& b=it->second;
    if(inserted) {b.tokens=config.burst; b.updated=now; b.window=now;}
    b.tokens=std::min(double(config.burst),b.tokens+std::chrono::duration<double>(now-b.updated).count()*config.ratePerSecond); b.updated=now;
    unsigned status=0;
    if(blocked) {++denied; status=403;} else if(b.tokens<1) {++limited; status=429;} else --b.tokens;
    if(status) {
        emit("request.completed",{{"source",source},{"status",status},{"reason",blocked?"source_denied":"rate_limited"}});
        if(now-b.window>std::chrono::milliseconds(config.violationWindowMs)) {b.window=now;b.violations=0;}
        ++b.violations;
        if(b.violations>=config.violationThreshold&&(b.lastIncident==Clock::time_point{}||now-b.lastIncident>=std::chrono::seconds(30))) {
            emit("detection.security",{{"source",source},{"violations",b.violations},{"windowMs",config.violationWindowMs},{"reason",blocked?"repeated_denial":"rate_limit_burst"}}); b.lastIncident=now;
        }
    }
    return status;
}
std::optional<std::size_t> State::selectBackend() {
    const auto count=config.backends.size();
    for(std::size_t attempt=0;attempt<count;++attempt) {
        const auto index=(nextBackend+attempt)%count;
        if(config.backends[index].healthy) {nextBackend=(index+1)%count; ++config.backends[index].requests; return index;}
    }
    return std::nullopt;
}
// state methods
}
