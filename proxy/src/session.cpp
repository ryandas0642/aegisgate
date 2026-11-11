#include "aegis/server.hpp"
#include <algorithm>
#include <cctype>
#include <set>
#include <sstream>

namespace aegis {
Session::Session(tcp::socket socket,std::shared_ptr<State> state,bool admin)
    :state_(std::move(state)),client_(std::move(socket)),upstream_(client_.get_executor()),resolver_(client_.get_executor()),deadline_(client_.get_executor()),input_(81920),output_(1064960),admin_(admin) {
    source_=client_.socket().remote_endpoint().address().to_v4().to_string();
    if(!admin_) ++state_->connections;
}
Session::~Session() {if(!admin_) --state_->connections;}
void Session::close() {
    beast::error_code ignored; deadline_.cancel(); resolver_.cancel();
    client_.socket().shutdown(tcp::socket::shutdown_both,ignored); client_.socket().close(ignored); upstream_.socket().close(ignored);
}
void Session::reply(unsigned status,const std::string& message) {
    if(responding_) return;
    response_={static_cast<http::status>(status),11}; response_.set(http::field::content_type,"application/json");
    response_.set(http::field::server,"AegisGate"); response_.set(http::field::cache_control,"no-store");
    if(status==429) response_.set(http::field::retry_after,"1");
    if(status==405) response_.set(http::field::allow,"GET, HEAD, POST");
    response_.body()=json::serialize(json::object{{"error",message}}); response_.prepare_payload(); send();
}
void Session::send() {
    if(responding_) return; responding_=true; deadline_.cancel(); resolver_.cancel();
    response_.keep_alive(false);
    if(!admin_) {
        if(response_.result_int()>=500) ++state_->errors;
        json::object event={{"source",source_},{"status",response_.result_int()},{"durationMs",std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now()-started_).count()}};
        if(backend_) event["backend"]=state_->config.backends[*backend_].id;
        // Admission already records denied requests once, with its reason.
        if(response_.result_int()!=403&&response_.result_int()!=429) state_->emit("request.completed",std::move(event));
    }
    client_.expires_after(std::chrono::milliseconds(state_->config.requestTimeoutMs));
    http::async_write(client_,response_,[self=shared_from_this()](beast::error_code,std::size_t){self->close();});
}
// session methods
}
