// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract UnderlyingToken is ERC20 {
    constructor(uint256 supply) ERC20("UnderlyingToken", "UTK") {
        _mint(msg.sender, supply);
    }
}