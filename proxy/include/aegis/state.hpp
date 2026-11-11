#pragma once
#include "aegis/ip.hpp"
#include <boost/json.hpp>
#include <chrono>
#include <deque>
#include <map>
#include <memory>
#include <string>

namespace aegis {
namespace json = boost::json;
using Clock = std::chrono::steady_clock;
struct Backend {
    std::string id, host; unsigned short port{};
    bool healthy=false; unsigned failures=0, successes=0;
    std::uint64_t requests=0;
};
struct Config {
    std::string listen="127.0.0.1", adminListen="127.0.0.1", healthPath="/health";
    unsigned short port=8080, adminPort=9090;
    unsigned healthIntervalMs=500, healthTimeoutMs=400, failureThreshold=2, recoveryThreshold=2;
    unsigned requestTimeoutMs=3000, maxConnections=64, ratePerSecond=10, burst=20;
    unsigned violationThreshold=10, violationWindowMs=5000;
    bool hasAllow=false;
    Cidrs allow, deny, eligible, protectedSources;
    std::vector<Backend> backends;
};
struct Bucket { double tokens=0; Clock::time_point updated{}, window{}, lastIncident{}; unsigned violations=0; };
struct Rule { std::string actionId, source, expiresAt; Clock::time_point expires; };
Config loadConfig(const std::string& path);
std::string utcNow();
struct State {
    Config config;
    std::string token, epoch;
    std::uint64_t revision=0, sequence=0, total=0, forwarded=0, denied=0, limited=0, errors=0;
    unsigned connections=0; std::size_t nextBackend=0;
    std::deque<json::object> events;
    std::map<std::uint32_t, Bucket> buckets;
    std::map<std::string, Rule> rules;
    std::map<std::string, json::object> applied;
    State(Config value, std::string secret);
    void emit(const std::string& type, json::object fields={});
    void expire();
    unsigned admit(const std::string& source);
    std::optional<std::size_t> selectBackend();
    json::object snapshot();
    json::object apply(const json::object& input);
};
}
