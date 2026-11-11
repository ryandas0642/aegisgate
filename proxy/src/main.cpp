#include "aegis/server.hpp"
#include <csignal>
#include <cstdlib>
#include <iostream>
int main(int argc,char** argv) {
    try {
        if(argc!=2) throw std::runtime_error("usage: aegis-proxy PATH_TO_CONFIG");
        const char* token=std::getenv("AEGIS_PROXY_TOKEN");
        auto state=std::make_shared<aegis::State>(aegis::loadConfig(argv[1]),token?token:"");
        aegis::net::io_context io;
        auto data=std::make_shared<aegis::Listener>(io,state,false),admin=std::make_shared<aegis::Listener>(io,state,true);
        data->accept();admin->accept();aegis::startHealthChecks(io,state);
        aegis::net::steady_timer expiry(io),drain(io);
        std::function<void()> tick;
        tick=[&]{expiry.expires_after(std::chrono::milliseconds(250));expiry.async_wait([&](auto ec){if(!ec){state->expire();tick();}});};tick();
        aegis::net::signal_set signals(io,SIGINT,SIGTERM);
        signals.async_wait([&](auto,int){
            data->stop();admin->stop();state->emit("proxy.draining");
            auto until=aegis::Clock::now()+std::chrono::seconds(10);
            auto wait=std::make_shared<std::function<void()>>();
            *wait=[&,until,wait]{
                if(state->connections==0||aegis::Clock::now()>=until){*wait={};io.stop();return;}
                drain.expires_after(std::chrono::milliseconds(50));drain.async_wait([wait](auto ec){if(!ec)(*wait)();});
            };(*wait)();
        });
        state->emit("proxy.started");
        std::cout<<"AegisGate proxy listening on "<<state->config.listen<<":"<<state->config.port<<std::endl;
        io.run();return 0;
    } catch(const std::exception& error) {std::cerr<<"Proxy stopped: "<<error.what()<<std::endl;return 1;}
}
