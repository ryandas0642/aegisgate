#include "aegis/ip.hpp"
#include <stdexcept>
namespace aegis {
std::uint32_t parseIPv4(const std::string& text) {
    std::uint32_t address = 0;
    std::size_t begin = 0;
    for (int part = 0; part < 4; ++part) {
        auto end = text.find('.', begin);
        if ((part < 3) == (end == std::string::npos)) throw std::invalid_argument("IPv4 requires four octets");
        auto octet = text.substr(begin, end == std::string::npos ? end : end - begin);
        if (octet.empty() || octet.size() > 3) throw std::invalid_argument("invalid IPv4 octet");
        unsigned value = 0;
        for (char digit : octet) {
            if (digit < '0' || digit > '9') throw std::invalid_argument("invalid IPv4 digit");
            value = value * 10 + static_cast<unsigned>(digit - '0');
        }
        if (value > 255) throw std::invalid_argument("IPv4 octet exceeds 255");
        address = (address << 8) | value;
        begin = end == std::string::npos ? text.size() : end + 1;
    }
    return address;
}
std::string formatIPv4(std::uint32_t ip) {
    return std::to_string(ip >> 24) + "." + std::to_string((ip >> 16) & 255) + "." +
        std::to_string((ip >> 8) & 255) + "." + std::to_string(ip & 255);
}

}

