#pragma once
#include <cstdint>
#include <string>
#include <optional>
#include <vector>

namespace aegis {
std::uint32_t parseIPv4(const std::string& text);
std::string formatIPv4(std::uint32_t ip);
struct Range { std::uint32_t network, mask; std::string cidr; };
class Cidrs {
    std::vector<Range> ranges_;
public:
    void addRange(const std::string& cidr);
    std::optional<std::string> match(std::uint32_t source) const;
};
}
