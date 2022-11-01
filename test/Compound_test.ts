import { takeSnapshot, SnapshotRestorer } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { parseUnits } from "ethers/lib/utils";
import { CErc20Immutable, Comptroller, UnderlyingToken } from "../typechain-types";

let snapshot: SnapshotRestorer,
    underlyingToken: UnderlyingToken,
    comptroller: Comptroller,
    whitePaperInterestRate,
    cErc20Token: CErc20Immutable,
    simplePriceOracle;

before(async function () {

    const [owner] = await ethers.getSigners();

    // underlying
    const UnderlyingTokenFactory = await ethers.getContractFactory("UnderlyingToken");
    underlyingToken = await UnderlyingTokenFactory.deploy(parseUnits("100", 18));
    await underlyingToken.deployed();


    // comptroller
    const ComptrollerFactory = await ethers.getContractFactory("Comptroller");
    comptroller = await ComptrollerFactory.deploy();
    await comptroller.deployed();

    // interestModel
    const WhitePaperInterestRateFactory = await ethers.getContractFactory("WhitePaperInterestRateModel");
    whitePaperInterestRate = await WhitePaperInterestRateFactory.deploy(parseUnits("0", 18), parseUnits("0", 18),);
    whitePaperInterestRate.deployed();

    // CErc20Immutable
    const CErc20ImmutableFactory = await ethers.getContractFactory("CErc20Immutable");
    cErc20Token = await CErc20ImmutableFactory.deploy(
        underlyingToken.address,
        comptroller.address,
        whitePaperInterestRate.address,
        parseUnits("1", 18),
        "compoundName",
        "COMP",
        18,
        owner.address
    );
    cErc20Token.deployed();
    comptroller._supportMarket(cErc20Token.address);

    // 使用 proxy contract 要注意 initialize 會有兩個（CErc20、CToken 各有），因此要用 signature 來選 initialize method
    // CErc20["initialize(address,address,address,uint256,string,string,uint8)"](
    //     underlyingToken.address,
    //     comptroller.address,
    //     parseUnits("1", 18),
    //     "compoundName",
    //     "COMP",
    //     18
    // );


    // simplePriceOracle
    const SimplePriceOracleFactory = await ethers.getContractFactory("SimplePriceOracle");
    simplePriceOracle = await SimplePriceOracleFactory.deploy();
    simplePriceOracle.deployed();
    comptroller._setPriceOracle(simplePriceOracle.address);

    snapshot = await takeSnapshot();
});

afterEach(async function () {
    // after doing some changes, you can restore to the state of the snapshot
    await snapshot.restore();
});

describe("Test mint and redeem", function () {
    it("Should be able to mint and redeem with underlyingToken", async () => {
        const [userA] = await ethers.getSigners();

        // userA 先要有些錢才能 mint 出 cErc20Token
        await underlyingToken.transfer(userA.address, parseUnits("100", 18));
        expect(await underlyingToken.balanceOf(userA.address)).to.equal(parseUnits("100", 18));

        // mint
        await underlyingToken.connect(userA).approve(cErc20Token.address, parseUnits("100", 18));
        await cErc20Token.connect(userA).mint(parseUnits("100", 18));
        expect(await cErc20Token.balanceOf(userA.address)).to.equal(parseUnits("100", 18));

        // redeem
        const userABalance = await cErc20Token.balanceOf(userA.address);
        expect(userABalance).to.equal(parseUnits("100", 18));
        await cErc20Token.connect(userA).redeem(userABalance.toString());
        expect(await cErc20Token.balanceOf(userA.address)).to.equal(0);
    });
});