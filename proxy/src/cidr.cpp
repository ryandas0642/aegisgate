#include "aegis/ip.hpp"
#include <stdexcept>
namespace aegis {
void Cidrs::addRange(const std::string &cidr) {
    auto slash = cidr.find('/');
    if (slash == std::string::npos)
        throw std::invalid_argument("CIDR requires /prefix");
    auto ip = parseIPv4(cidr.substr(0, slash));
    auto prefixText = cidr.substr(slash + 1);
    if (prefixText.empty() || prefixText.size() > 2)
        throw std::invalid_argument("invalid CIDR prefix");
    unsigned prefix = 0;
    for (char c : prefixText) {
        if (c < '0' || c > '9')
            throw std::invalid_argument("invalid CIDR prefix");
        prefix = prefix * 10 + static_cast<unsigned>(c - '0');
    }
    if (prefix > 32)
        throw std::invalid_argument("CIDR prefix exceeds 32");
    auto mask = prefix == 0 ? 0u : 0xffffffffu << (32 - prefix);
    ranges_.push_back({ip & mask, mask, cidr});
}

std::optional<std::string> Cidrs::match(std::uint32_t source) const {
    for (const auto &range : ranges_)
        if ((source & range.mask) == range.network)
            return range.cidr;
    return std::nullopt;
}
} // namespace aegis
