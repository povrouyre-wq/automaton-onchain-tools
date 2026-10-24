// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
// Read-only honeypot simulator. Never deployed: injected via eth_call state override, so nothing touches the chain.
interface IV2 { function getReserves() external view returns (uint112, uint112, uint32); function token0() external view returns (address); function swap(uint, uint, address, bytes calldata) external; }
interface IV3 { function swap(address, bool, int256, uint160, bytes calldata) external returns (int256, int256); function token0() external view returns (address); }
contract Sim {
    address private cbPool; address private cbToken;
    function _bal(address t, address a) internal view returns (uint b) { (bool ok, bytes memory d) = t.staticcall(abi.encodeWithSelector(0x70a08231, a)); if (ok && d.length >= 32) b = abi.decode(d, (uint)); }
    function _xfer(address t, address to, uint v) internal returns (bool, bytes memory) {
        (bool ok, bytes memory d) = t.call(abi.encodeWithSelector(0xa9059cbb, to, v));
        if (ok && d.length > 0 && !abi.decode(d, (bool))) ok = false; return (ok, d);
    }
    // Router-style move: approve ourselves, then transferFrom. Catches honeypots that break allowances (e.g. zeroing approvals for non-insiders).
    function _xferFrom(address t, address to, uint v) internal returns (bool ok, bytes memory d) {
        (ok, d) = t.call(abi.encodeWithSelector(0x095ea7b3, address(this), v));
        if (ok && d.length > 0 && !abi.decode(d, (bool))) ok = false; if (!ok) return (ok, d);
        (ok, d) = t.call(abi.encodeWithSelector(0x23b872dd, address(this), to, v));
        if (ok && d.length > 0 && !abi.decode(d, (bool))) ok = false;
    }
    function _out(address pair, uint mode, uint feeBps, uint amtIn, uint rIn, uint rOut, address tokenIn) internal view returns (uint) {
        if (mode == 1) { (bool ok, bytes memory d) = pair.staticcall(abi.encodeWithSignature("getAmountOut(uint256,address)", amtIn, tokenIn)); return ok && d.length >= 32 ? abi.decode(d, (uint)) : 0; }
        uint a = amtIn * (10000 - feeBps); return a * rOut / (rIn * 10000 + a);
    }
    function _res(address pair, bool wIs0) internal view returns (uint w, uint t) { (uint112 r0, uint112 r1,) = IV2(pair).getReserves(); (w, t) = wIs0 ? (uint(r0), uint(r1)) : (uint(r1), uint(r0)); }
    // r: [0] buy requested out, [1] buy received, [2] sell sent, [3] pair received, [4] sell requested out, [5] sell received (wrapped native)
    function v2(address pair, address weth, address token, uint amountIn, uint mode, uint feeBps) external payable returns (uint8 stage, uint[6] memory r, bytes memory err) {
        (bool ok,) = weth.call{value: amountIn}(abi.encodeWithSignature("deposit()")); if (!ok) return (9, r, "");
        bool wIs0 = IV2(pair).token0() == weth;
        (uint wRes, uint tRes) = _res(pair, wIs0);
        (ok, err) = _xfer(weth, pair, amountIn); if (!ok) return (9, r, err);
        r[0] = _out(pair, mode, feeBps, amountIn, wRes, tRes, weth) * 995 / 1000;
        uint b0 = _bal(token, address(this));
        (ok, err) = pair.call(abi.encodeWithSelector(IV2.swap.selector, wIs0 ? 0 : r[0], wIs0 ? r[0] : 0, address(this), bytes("")));
        if (!ok) return (1, r, err);
        r[1] = _bal(token, address(this)) - b0; r[2] = r[1];
        if (r[1] == 0) return (2, r, "");
        (wRes, tRes) = _res(pair, wIs0);
        (ok, err) = _xferFrom(token, pair, r[2]); if (!ok) return (3, r, err);
        r[3] = _bal(token, pair) - tRes;
        r[4] = _out(pair, mode, feeBps, r[3], tRes, wRes, token) * 995 / 1000;
        uint w0 = _bal(weth, address(this));
        (ok, err) = pair.call(abi.encodeWithSelector(IV2.swap.selector, wIs0 ? r[4] : 0, wIs0 ? 0 : r[4], address(this), bytes("")));
        if (!ok) return (4, r, err);
        r[5] = _bal(weth, address(this)) - w0;
        return (0, r, "");
    }
    // V3-style concentrated liquidity pool (Uniswap V3 / PancakeSwap V3 callbacks).
    // r: [0] pool says sent (buy), [1] buy received, [2] sell sent, [3] -, [4] pool says sent (sell), [5] sell received
    function v3(address pool, address weth, address token, uint amountIn) external payable returns (uint8 stage, uint[6] memory r, bytes memory err) {
        (bool ok,) = weth.call{value: amountIn}(abi.encodeWithSignature("deposit()")); if (!ok) return (9, r, "");
        bool wIs0 = IV3(pool).token0() == weth; cbPool = pool;
        uint b0 = _bal(token, address(this));
        bytes memory d;
        (ok, d) = pool.call(abi.encodeWithSelector(IV3.swap.selector, address(this), wIs0, int256(amountIn), wIs0 ? uint160(4295128740) : uint160(1461446703485210103287273052203988822378723970341), bytes("")));
        if (!ok) return (1, r, d);
        (int256 a0, int256 a1) = abi.decode(d, (int256, int256));
        r[0] = uint(-(wIs0 ? a1 : a0)); r[1] = _bal(token, address(this)) - b0; r[2] = r[1];
        if (r[1] == 0) return (2, r, "");
        uint w0 = _bal(weth, address(this));
        (ok, d) = pool.call(abi.encodeWithSelector(IV3.swap.selector, address(this), !wIs0, int256(r[2]), !wIs0 ? uint160(4295128740) : uint160(1461446703485210103287273052203988822378723970341), bytes("")));
        if (!ok) return (4, r, d);
        (a0, a1) = abi.decode(d, (int256, int256));
        r[4] = uint(-(wIs0 ? a0 : a1)); r[5] = _bal(weth, address(this)) - w0;
        return (0, r, "");
    }
    function _cb(int256 a0, int256 a1) internal {
        require(msg.sender == cbPool, "cb");
        address t0 = IV3(msg.sender).token0();
        if (a0 > 0) { (bool ok, bytes memory e) = _xfer(t0, msg.sender, uint(a0)); if (!ok) assembly { revert(add(e, 32), mload(e)) } }
        if (a1 > 0) { (bool ok, bytes memory d) = msg.sender.staticcall(abi.encodeWithSignature("token1()")); address t1 = abi.decode(d, (address)); ok;
            (bool ok2, bytes memory e) = _xfer(t1, msg.sender, uint(a1)); if (!ok2) assembly { revert(add(e, 32), mload(e)) } }
    }
    function uniswapV3SwapCallback(int256 a0, int256 a1, bytes calldata) external { _cb(a0, a1); }
    function pancakeV3SwapCallback(int256 a0, int256 a1, bytes calldata) external { _cb(a0, a1); }
    // Transfer test: this code is placed at an existing holder's address, so msg.sender for the token is that holder.
    function xfer(address token, address to, uint amt) external returns (bool ok, uint received, bytes memory err) {
        uint b0 = _bal(token, to); (ok, err) = _xfer(token, to, amt); if (ok) received = _bal(token, to) - b0;
    }
}
