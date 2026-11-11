#include "aegis/server.hpp"
namespace aegis {
class Probe:public std::enable_shared_from_this<Probe> {
    std::shared_ptr<State> state_; std::size_t index_;
    beast::tcp_stream stream_; tcp::resolver resolver_; net::steady_timer deadline_,delay_;
    beast::flat_buffer buffer_{8192}; http::request<http::empty_body> request_;
    http::response_parser<http::string_body> parser_; bool finished_=false;
public:
    Probe(net::io_context& io,std::shared_ptr<State> state,std::size_t index):state_(std::move(state)),index_(index),stream_(io),resolver_(io),deadline_(io),delay_(io) {}
    void finish(bool success) {
        if(finished_) return; finished_=true; deadline_.cancel();resolver_.cancel();beast::error_code ignored;stream_.socket().close(ignored);
        auto& b=state_->config.backends[index_];
        if(success) {
            b.failures=0; b.successes=std::min(b.successes+1,state_->config.recoveryThreshold);
            if(!b.healthy&&b.successes>=state_->config.recoveryThreshold) {b.healthy=true;state_->emit("backend.healthy",{{"backend",b.id},{"successes",b.successes}});}
        } else {
            b.successes=0;b.failures=std::min(b.failures+1,1000u);
            if(b.healthy||b.failures==state_->config.failureThreshold) {
                if(b.failures>=state_->config.failureThreshold) {b.healthy=false;state_->emit("detection.reliability",{{"backend",b.id},{"failures",b.failures},{"reason","health_check_failed"}});}
            }
        }
        delay_.expires_after(std::chrono::milliseconds(state_->config.healthIntervalMs));
        delay_.async_wait([self=shared_from_this()](beast::error_code ec){if(!ec) std::make_shared<Probe>(static_cast<net::io_context&>(self->stream_.get_executor().context()),self->state_,self->index_)->run();});
    }
    void run() {
        auto& b=state_->config.backends[index_];
        request_={http::verb::get,state_->config.healthPath,11}; request_.set(http::field::host,b.host); request_.keep_alive(false);
        parser_.body_limit(4096);parser_.header_limit(4096);
        deadline_.expires_after(std::chrono::milliseconds(state_->config.healthTimeoutMs));
        deadline_.async_wait([self=shared_from_this()](beast::error_code ec){if(!ec)self->finish(false);});
        resolver_.async_resolve(b.host,std::to_string(b.port),[self=shared_from_this()](beast::error_code ec,tcp::resolver::results_type endpoints){
            if(self->finished_)return; if(ec)return self->finish(false);
            self->stream_.async_connect(endpoints,[self](beast::error_code error,const tcp::endpoint&){
                if(self->finished_)return;if(error)return self->finish(false);
                http::async_write(self->stream_,self->request_,[self](beast::error_code e,std::size_t){
                    if(self->finished_)return;if(e)return self->finish(false);
                    http::async_read(self->stream_,self->buffer_,self->parser_,[self](beast::error_code err,std::size_t){self->finish(!err&&self->parser_.get().result()==http::status::ok);});
                });
            });
        });
    }
};
void startHealthChecks(net::io_context& io,std::shared_ptr<State> state) {
    for(std::size_t i=0;i<state->config.backends.size();++i)std::make_shared<Probe>(io,state,i)->run();
}
}
