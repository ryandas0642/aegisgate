#include "aegis/state.hpp"
#include <fstream>
#include <iterator>
#include <set>
#include <stdexcept>
namespace aegis {
Config loadConfig(const std::string& path) {
    std::ifstream file(path);
    if (!file) throw std::runtime_error("cannot open proxy configuration");
    std::string text((std::istreambuf_iterator<char>(file)), {});
    if (text.size() > 65536) throw std::runtime_error("configuration too large");
    auto value=json::parse(text); auto& o=value.as_object(); Config c;
    const std::set<std::string> keys={"listen","port","adminListen","adminPort","healthPath","healthIntervalMs","healthTimeoutMs","failureThreshold","recoveryThreshold","requestTimeoutMs","maxConnections","ratePerSecond","burst","violationThreshold","violationWindowMs","allow","deny","eligible","protectedSources","backends"};
    for (const auto& entry:o) if (!keys.count(std::string(entry.key()))) throw std::runtime_error("unknown configuration key");
    auto number=[&](const char* key,unsigned fallback,unsigned low,unsigned high) {
        if (!o.contains(key)) return fallback;
        auto n=o.at(key).as_int64(); if(n<low||n>high) throw std::runtime_error(std::string("invalid ")+key); return unsigned(n);
    };
    auto string=[&](const char* key,std::string fallback) {return o.contains(key)?std::string(o.at(key).as_string()):fallback;};
    c.listen=string("listen",c.listen); c.adminListen=string("adminListen",c.adminListen);
    parseIPv4(c.listen); parseIPv4(c.adminListen);
    c.port=static_cast<unsigned short>(number("port",8080,1024,65535)); c.adminPort=static_cast<unsigned short>(number("adminPort",9090,1024,65535));
    if(c.port==c.adminPort) throw std::runtime_error("listeners must use different ports");
    c.healthPath=string("healthPath",c.healthPath);
    if(c.healthPath.empty()||c.healthPath[0]!='/'||c.healthPath.size()>128||c.healthPath.find_first_of("\r\n ")!=std::string::npos) throw std::runtime_error("invalid health path");
    c.healthIntervalMs=number("healthIntervalMs",500,100,30000); c.healthTimeoutMs=number("healthTimeoutMs",400,50,10000);
    c.failureThreshold=number("failureThreshold",2,1,10); c.recoveryThreshold=number("recoveryThreshold",2,1,10);
    c.requestTimeoutMs=number("requestTimeoutMs",3000,100,30000); c.maxConnections=number("maxConnections",64,1,256);
    c.ratePerSecond=number("ratePerSecond",10,1,1000); c.burst=number("burst",20,1,2000);
    c.violationThreshold=number("violationThreshold",10,2,1000); c.violationWindowMs=number("violationWindowMs",5000,1000,60000);
    for(auto pair:{std::pair{"allow",&c.allow},{"deny",&c.deny},{"eligible",&c.eligible},{"protectedSources",&c.protectedSources}}) {
        if(o.contains(pair.first)) { auto& a=o.at(pair.first).as_array(); if(a.size()>128) throw std::runtime_error("too many CIDRs"); for(auto& x:a) pair.second->addRange(std::string(x.as_string())); }
    }
    if(!o.contains("backends")||o.at("backends").as_array().empty()||o.at("backends").as_array().size()>16) throw std::runtime_error("configure 1 to 16 backends");
    std::set<std::string> ids;
    for(const auto& item:o.at("backends").as_array()) {
        const auto& b=item.as_object();
        if(b.size()!=3) throw std::runtime_error("backend requires id, host, port");
        auto id=std::string(b.at("id").as_string()),host=std::string(b.at("host").as_string());
        if(id.empty()||id.size()>32||id.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")!=std::string::npos||!ids.insert(id).second) throw std::runtime_error("invalid backend ID");
        if(host.empty()||host.size()>128||host.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-")!=std::string::npos) throw std::runtime_error("invalid backend host");
        auto port=b.at("port").as_int64(); if(port<1024||port>65535) throw std::runtime_error("invalid backend port");
        c.backends.push_back({id,host,static_cast<unsigned short>(port)});
    }
    return c;
}
}
