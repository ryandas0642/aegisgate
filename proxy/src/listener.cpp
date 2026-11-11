#include "aegis/server.hpp"
namespace aegis {
Listener::Listener(net::io_context &io, std::shared_ptr<State> state, bool admin)
    : acceptor_(io), state_(std::move(state)), admin_(admin) {
    auto &c = state_->config;
    tcp::endpoint endpoint(net::ip::make_address_v4(admin ? c.adminListen : c.listen),
                           admin ? c.adminPort : c.port);
    acceptor_.open(endpoint.protocol());
    acceptor_.set_option(net::socket_base::reuse_address(true));
    acceptor_.bind(endpoint);
    acceptor_.listen(64);
}
void Listener::accept() {
    acceptor_.async_accept([self = shared_from_this()](beast::error_code ec, tcp::socket socket) {
        if (!ec) {
            if ((!self->admin_ &&
                 self->state_->connections >= self->state_->config.maxConnections) ||
                (self->admin_ && self->state_->adminConnections >= 8)) {
                beast::error_code ignored;
                socket.close(ignored);
                self->state_->emit("connection.rejected", {{"reason", "connection_capacity"}});
            } else
                std::make_shared<Session>(std::move(socket), self->state_, self->admin_)->run();
        }
        if (self->acceptor_.is_open())
            self->accept();
    });
}
void Listener::stop() {
    beast::error_code ignored;
    acceptor_.close(ignored);
}
} // namespace aegis
