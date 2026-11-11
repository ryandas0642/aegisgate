#pragma once
#include "aegis/state.hpp"
#include <boost/asio.hpp>
#include <boost/beast.hpp>
#include <optional>

namespace aegis {
namespace net = boost::asio;
namespace beast = boost::beast;
namespace http = beast::http;
using tcp = net::ip::tcp;
class Session : public std::enable_shared_from_this<Session> {
    std::shared_ptr<State> state_;
    beast::tcp_stream client_, upstream_;
    tcp::resolver resolver_;
    net::steady_timer deadline_;
    beast::flat_buffer input_, output_;
    http::request_parser<http::string_body> parser_;
    http::response_parser<http::string_body> upstreamParser_;
    http::request<http::string_body> request_;
    http::response<http::string_body> response_;
    std::optional<http::response_serializer<http::string_body>> serializer_;
    bool admin_, responding_ = false;
    std::string source_;
    std::optional<std::size_t> backend_;
    Clock::time_point started_ = Clock::now();

  public:
    Session(tcp::socket socket, std::shared_ptr<State> state, bool admin);
    ~Session();
    void run();
    void header();
    void dispatch();
    void forward();
    void receive();
    void reply(unsigned status, const std::string &message);
    void send();
    void close();
};
class Listener : public std::enable_shared_from_this<Listener> {
    tcp::acceptor acceptor_;
    std::shared_ptr<State> state_;
    bool admin_;

  public:
    Listener(net::io_context &io, std::shared_ptr<State> state, bool admin);
    void accept();
    void stop();
};
void startHealthChecks(net::io_context &io, std::shared_ptr<State> state);
} // namespace aegis
