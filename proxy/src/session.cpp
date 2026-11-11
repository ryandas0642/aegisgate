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
// session methods
}
