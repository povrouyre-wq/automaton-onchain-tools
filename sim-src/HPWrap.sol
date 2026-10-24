// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
// TEST ONLY. Turns a real token into a synthetic bad token inside an eth_call: placed at the token's address via state override,
// it delegatecalls the token's original code (copied to IMPL). Mode 1: any transfer to PAIR reverts (honeypot).
// Mode 2: transfers to PAIR are split 90% to PAIR / 10% to 0xdEaD (a 10% sell tax).
contract HPWrap {
    bytes32 constant PAIR_SLOT = keccak256("hpwrap.pair"); bytes32 constant IMPL_SLOT = keccak256("hpwrap.impl"); bytes32 constant MODE_SLOT = keccak256("hpwrap.mode");
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    function _sl(bytes32 k) internal view returns (uint v) { assembly { v := sload(k) } }
    function _dc(address impl, bytes memory d) internal { (bool ok, bytes memory r) = impl.delegatecall(d); if (!ok) assembly { revert(add(r, 32), mload(r)) } }
    fallback() external payable {
        address pair = address(uint160(_sl(PAIR_SLOT))); address impl = address(uint160(_sl(IMPL_SLOT))); uint mode = _sl(MODE_SLOT);
        bytes4 sel = msg.sig;
        if (sel == 0xa9059cbb || sel == 0x23b872dd) {
            bool tf = sel == 0x23b872dd; address from; address to; uint amt;
            if (tf) (from, to, amt) = abi.decode(msg.data[4:], (address, address, uint)); else (to, amt) = abi.decode(msg.data[4:], (address, uint));
            if (to == pair && pair != address(0)) {
                if (mode == 1) revert("HP: selling disabled");
                if (mode == 2) { uint tax = amt / 10;
                    if (tf) { _dc(impl, abi.encodeWithSelector(0x23b872dd, from, pair, amt - tax)); _dc(impl, abi.encodeWithSelector(0x23b872dd, from, DEAD, tax)); }
                    else { _dc(impl, abi.encodeWithSelector(0xa9059cbb, pair, amt - tax)); _dc(impl, abi.encodeWithSelector(0xa9059cbb, DEAD, tax)); }
                    assembly { mstore(0, 1) return(0, 32) } }
            }
        }
        assembly { calldatacopy(0, 0, calldatasize()) let ok := delegatecall(gas(), impl, 0, calldatasize(), 0, 0) returndatacopy(0, 0, returndatasize()) switch ok case 0 { revert(0, returndatasize()) } default { return(0, returndatasize()) } }
    }
}
