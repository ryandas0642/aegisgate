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
    std::cout << "IP parsing passed\n";
}
