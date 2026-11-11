#include "aegis/ip.hpp"
#include <cassert>
#include <stdexcept>
#include <iostream>
int main() {
    assert(aegis::formatIPv4(aegis::parseIPv4("192.0.2.9")) == "192.0.2.9");
    for (const auto& text : {"1.2.3", "1.2.3.256", "1.2.3.-1", "1.2.3.4.5", "1.2.3.4x"}) {
        bool rejected = false;
        try { aegis::parseIPv4(text); } catch (const std::invalid_argument&) { rejected = true; }
        assert(rejected);
    }
    aegis::Cidrs range; range.addRange("192.0.2.129/24");
    assert(range.match(aegis::parseIPv4("192.0.2.0")));
    assert(range.match(aegis::parseIPv4("192.0.2.255")));
    assert(!range.match(aegis::parseIPv4("192.0.3.1")));
    aegis::Cidrs all; all.addRange("0.0.0.0/0"); assert(all.match(0xffffffff));
    aegis::Cidrs one; one.addRange("127.0.0.2/32"); assert(one.match(aegis::parseIPv4("127.0.0.2")));
    assert(!one.match(aegis::parseIPv4("127.0.0.3")));
    for (auto text : {"1.2.3.4/33", "1.2.3.4/-1", "1.2.3.4/", "1.2.3.4"}) {
        bool rejected=false; try { range.addRange(text); } catch (...) { rejected=true; } assert(rejected);
    }
    std::cout << "IP and CIDR tests passed\n";
}
