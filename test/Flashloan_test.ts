import { ethers, } from "hardhat";
import { loadFixture, impersonateAccount } from "@nomicfoundation/hardhat-network-helpers";
import { parseUnits } from "ethers/lib/utils";
import { expect } from "chai";
import { printAccountLiquidity } from "./utils";

const { Logger, LogLevel } = require("@ethersproject/logger");

Logger.setLogLevel(LogLevel.ERROR);

const BINANCE_WALLET_ADDRESS = '0xF977814e90dA44bFA03b6295A0616a897441aceC';

const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const UNI_ADDRESS = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984";

const AVVE_LENDING_POOL_ADDRESSES_PROVIDER = "0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5";
const UNI_SWAP_ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564';

const USDC_AMOUNT = parseUnits('5000', 6);
const UNI_AMOUNT = parseUnits('1000', 18);
const CLOSE_FACTOR = parseUnits("0.5", 18);

async function deployContractsFixture() {
  const [user1, user2] = await ethers.getSigners();

  const priceOracleFactory = await ethers.getContractFactory("SimplePriceOracle");
  const simplePriceOracle = await priceOracleFactory.deploy();
  await simplePriceOracle.deployed();

  const interestRateModelFactory = await ethers.getContractFactory("WhitePaperInterestRateModel");
  const interestRateModel = await interestRateModelFactory.deploy(parseUnits("0", 18), parseUnits("0", 18));
  await interestRateModel.deployed();

  const comptrollerFactory = await ethers.getContractFactory("Comptroller");
  const comptroller = await comptrollerFactory.deploy();
  await comptroller.deployed();

  const usdc = await ethers.getContractAt("Erc20", USDC_ADDRESS);
  expect(await usdc.balanceOf(BINANCE_WALLET_ADDRESS)).to.gt(0)

  const uni = await ethers.getContractAt("Erc20", UNI_ADDRESS);
  expect(await uni.balanceOf(BINANCE_WALLET_ADDRESS)).to.gt(0)

  const cErc20Factory = await ethers.getContractFactory("CErc20Immutable");

  const cUSDC = await cErc20Factory.deploy(
    usdc.address,
    comptroller.address,
    interestRateModel.address,
    ethers.utils.parseUnits("1", 6),
    "cUSDC",
    "cUSDC",
    18,
    user1.address,
  );
  await cUSDC.deployed();

  const cUNI = await cErc20Factory.deploy(
    uni.address,
    comptroller.address,
    interestRateModel.address,
    ethers.utils.parseUnits("1", 18),
    "cUNI",
    "cUNI",
    18,
    user1.address,
  );
  await cUNI.deployed();

  const USDC_PRICE = parseUnits('1', 18 + (18 - 6)); // usdc 小數點只到 6 位數，需要補 18 位數以上
  const UNI_PRICE = parseUnits('10', 18);
  await simplePriceOracle.setUnderlyingPrice(cUSDC.address, USDC_PRICE);
  await simplePriceOracle.setUnderlyingPrice(cUNI.address, UNI_PRICE);

  await comptroller._setPriceOracle(simplePriceOracle.address);

  await comptroller._supportMarket(cUSDC.address);
  await comptroller._supportMarket(cUNI.address);

  await comptroller.enterMarkets([cUNI.address]);

  const UNI_COLLATERAL_FACTOR = parseUnits("0.5", 18);
  await comptroller._setCollateralFactor(cUNI.address, UNI_COLLATERAL_FACTOR);

  await comptroller._setCloseFactor(CLOSE_FACTOR);

  const LIQUIDATION_INCENTIVE = parseUnits("1.08", 18);
  await comptroller._setLiquidationIncentive(LIQUIDATION_INCENTIVE);

  const flashLoanFactory = await ethers.getContractFactory("FlashLoanReceiver");
  const flashLoanReceiver = await flashLoanFactory.deploy(
    AVVE_LENDING_POOL_ADDRESSES_PROVIDER,
    UNI_SWAP_ROUTER_ADDRESS
  );
  await flashLoanReceiver.deployed()

  return {
    user1,
    user2,
    usdc,
    cUSDC,
    uni,
    cUNI,
    flashLoanReceiver,
    comptroller,
    simplePriceOracle,
  }
}

async function transferTokenFixture() {
  const {
    user1,
    user2,
    usdc,
    cUSDC,
    uni,
    cUNI,
    flashLoanReceiver,
    comptroller,
    simplePriceOracle,
  } = await loadFixture(deployContractsFixture);

  await impersonateAccount(BINANCE_WALLET_ADDRESS);
  const binance = await ethers.getSigner(BINANCE_WALLET_ADDRESS);

  usdc.connect(binance).transfer(user2.address, USDC_AMOUNT);
  uni.connect(binance).transfer(user1.address, UNI_AMOUNT);

  expect(await usdc.balanceOf(user2.address)).to.eq(USDC_AMOUNT);
  expect(await uni.balanceOf(user1.address)).to.eq(UNI_AMOUNT);

  return {
    user1,
    user2,
    usdc,
    cUSDC,
    uni,
    cUNI,
    binance,
    flashLoanReceiver,
    comptroller,
    simplePriceOracle,
  }
}


async function borrowUSDCFixture() {
  const {
    user1,
    user2,
    usdc,
    cUSDC,
    uni,
    cUNI,
    flashLoanReceiver,
    comptroller,
    simplePriceOracle
  } = await loadFixture(transferTokenFixture);

  // user2 supply 5000 USDC
  await usdc.connect(user2).approve(cUSDC.address, USDC_AMOUNT);
  await cUSDC.connect(user2).mint(USDC_AMOUNT);

  // supply 1000 UNI
  await uni.approve(cUNI.address, UNI_AMOUNT);
  await cUNI.mint(UNI_AMOUNT);

  // user1 borrow 5000 USDC
  await cUSDC.borrow(USDC_AMOUNT);

  return {
    user1,
    user2,
    usdc,
    cUSDC,
    uni,
    cUNI,
    flashLoanReceiver,
    comptroller,
    simplePriceOracle,
  }
}

describe("Flash Loan", async function () {

  it("Using UNI as collateral to borrow USDC", async () => {
    const {
      user1,
      user2,
      usdc,
      cUSDC,
      uni,
      cUNI,
    } = await loadFixture(transferTokenFixture);

    // supply 5000 USDC
    await usdc.connect(user2).approve(cUSDC.address, USDC_AMOUNT);
    await cUSDC.connect(user2).mint(USDC_AMOUNT);
    expect(await cUSDC.balanceOf(user2.address)).to.eq(USDC_AMOUNT.mul(parseUnits('1', 12)));

    // supply 1000 UNI
    await uni.approve(cUNI.address, UNI_AMOUNT);
    await cUNI.mint(UNI_AMOUNT);

    await expect(cUSDC.borrow(USDC_AMOUNT)).to
      .changeTokenBalances(
        usdc,
        [user1, cUSDC],
        [USDC_AMOUNT, -USDC_AMOUNT],
      );
  });

  it("Do flash loan should be success", async () => {
    const {
      user1,
      user2,
      usdc,
      cUSDC,
      uni,
      cUNI,
      flashLoanReceiver,
      comptroller,
      simplePriceOracle,
    } = await loadFixture(borrowUSDCFixture)

    const DROP_UNI_PRICE = parseUnits('6.2', 18);
    await simplePriceOracle.setUnderlyingPrice(cUNI.address, DROP_UNI_PRICE);

    const shortfall = await printAccountLiquidity(user1.address, comptroller);
    expect(shortfall).to.gt(0);

    const borrowBalance = await cUSDC.callStatic.borrowBalanceCurrent(user1.address);
    console.log(borrowBalance)

    const repayAmount = parseUnits(borrowBalance.toString(), 0).mul(CLOSE_FACTOR).div(parseUnits('1', 18));

    const abi = new ethers.utils.AbiCoder();
    const flashLoanTx = await flashLoanReceiver.connect(user2)
      .flashLoan(
        [usdc.address],
        [repayAmount],
        abi.encode(
          ['address', 'address', 'address', 'address'],
          [user1.address, cUSDC.address, cUNI.address, uni.address],
        ),
      );

    console.log((await flashLoanTx.wait()).events.filter((e: any) => !!e.event));

    const reward = await usdc.balanceOf(flashLoanReceiver.address)

    expect(reward).to.gt(0);

    console.log(`FlashLoan liquidated reward: ${reward}`)
  });

});
