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
// state methods
}
