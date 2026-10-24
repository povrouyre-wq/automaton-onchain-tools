import solc from "solc"; import { readFileSync, writeFileSync } from "fs";
const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "Sim.sol": { content: readFileSync("Sim.sol", "utf8") } }, settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, outputSelection: { "*": { "*": ["abi", "evm.deployedBytecode.object"] } } } })));
for (const e of out.errors || []) console.log(e.severity, e.formattedMessage);
const c = out.contracts["Sim.sol"].Sim; writeFileSync("sim-artifact.json", JSON.stringify({ abi: c.abi, code: "0x" + c.evm.deployedBytecode.object }));
console.log("bytes", c.evm.deployedBytecode.object.length / 2);
