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
void Session::run() {
    parser_.header_limit(admin_?8192:16384); parser_.body_limit(admin_?4096:65536);
    client_.expires_after(std::chrono::milliseconds(state_->config.requestTimeoutMs));
    http::async_read_header(client_,input_,parser_,[self=shared_from_this()](beast::error_code ec,std::size_t){
        if(ec) {
            if(ec==http::error::end_of_stream||ec==beast::error::timeout) return self->close();
            return self->reply(ec==http::error::header_limit?431:ec==http::error::body_limit?413:400,"request parsing rejected");
        }
        self->header();
    });
}
void Session::header() {
    const auto& h=parser_.get();
    if(h.version()!=11) return reply(505,"only HTTP/1.1 is supported");
    if(h.count(http::field::host)!=1||h.count(http::field::content_length)>1||h.count(http::field::transfer_encoding)) return reply(400,"ambiguous or unsupported framing");
    if(h.count(http::field::expect)) return reply(417,"expectations are unsupported");
    if(h.target().empty()||h.target()[0]!='/'||h.target().size()>2048) return reply(400,"origin-form target required");
    if(admin_) {
        const std::string expected="Bearer "+state_->token,actual=std::string(h[http::field::authorization]);
        unsigned difference=unsigned(expected.size()^actual.size());
        if(expected.size()==actual.size()) for(std::size_t i=0;i<expected.size();++i) difference|=unsigned(expected[i]^actual[i]);
        if(difference||h.count(http::field::authorization)!=1) return reply(401,"administrative authentication required");
    } else {
        if(h.method()!=http::verb::get&&h.method()!=http::verb::head&&h.method()!=http::verb::post) return reply(405,"method unsupported");
        if(h.method()==http::verb::post&&!parser_.content_length()) return reply(411,"Content-Length required");
        if(h.method()!=http::verb::post&&parser_.content_length().value_or(0)!=0) return reply(400,"GET and HEAD bodies unsupported");
        if(const auto status=state_->admit(source_)) return reply(status,status==403?"source denied":"client rate limit exceeded");
    }
    if(parser_.is_done()) {request_=parser_.release(); return dispatch();}
    http::async_read(client_,input_,parser_,[self=shared_from_this()](beast::error_code ec,std::size_t){
        if(ec) return self->reply(ec==http::error::body_limit?413:400,"request body rejected");
        self->request_=self->parser_.release(); self->dispatch();
    });
}
void Session::dispatch() {
    if(input_.size()) return reply(400,"pipelined messages are unsupported");
    if(!admin_) return forward();
    try {
        json::object result;
        if(request_.method()==http::verb::get&&request_.target()=="/v1/state") result=state_->snapshot();
        else if(request_.method()==http::verb::post&&request_.target()=="/v1/actions/deny") result=state_->apply(json::parse(request_.body()).as_object());
        else return reply(404,"administrative route not found");
        response_={http::status::ok,11}; response_.set(http::field::content_type,"application/json");
        response_.body()=json::serialize(result); response_.prepare_payload(); send();
    } catch(const std::exception&) {reply(409,"invalid, stale, or out-of-scope action");}
}
// session methods
}
