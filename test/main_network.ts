import { ethers } from "hardhat";
import {impersonateAccount} from "@nomicfoundation/hardhat-network-helpers";
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai"); 


describe("Test", function () {
  let usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  let binanceHotWalletAddress = '0xF977814e90dA44bFA03b6295A0616a897441aceC'
  let accounts;
  let usdc;
  describe("Are we in mainnet?", function () {
    it("BinanceWallet should contain USDC", async function () {
      accounts = await ethers.getSigners();
      usdc = await ethers.getContractAt("MyToken", usdcAddress);
      let balance = await usdc.balanceOf(binanceHotWalletAddress)
      expect(balance).to.gt(0)
      console.log(`Binance wallet USDC balance: ${balance}`)
    });
    it("Ask Binance to give me USDC", async function () {
      let transferAmount = 10000000
      await impersonateAccount(binanceHotWalletAddress)        
      const binanceWallet = await ethers.getSigner(
        binanceHotWalletAddress);
      await usdc.connect(binanceWallet).transfer(accounts[0].address, transferAmount)
      let balance = await usdc.balanceOf(accounts[0].address)
      console.log(`Our wallet USDC balance: ${balance}`)
      expect(balance).to.eq(transferAmount)
    })
  });
});