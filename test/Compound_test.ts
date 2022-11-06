import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { parseUnits } from "ethers/lib/utils";
import { CErc20Immutable, Comptroller, SimplePriceOracle, UnderlyingToken } from "@/typechain-types";
import { printAccountLiquidity } from "./utils";


async function deployContractsFixture() {
    let underlyingERC20TokenA: UnderlyingToken,
        underlyingERC20TokenB: UnderlyingToken,
        comptroller: Comptroller,
        whitePaperInterestRate,
        cErc20TokenA: CErc20Immutable,
        cErc20TokenB: CErc20Immutable,
        simplePriceOracle: SimplePriceOracle;

    const [owner, userA, userB] = await ethers.getSigners();

    // underlying
    const UnderlyingTokenFactory = await ethers.getContractFactory("UnderlyingToken");
    underlyingERC20TokenA = await UnderlyingTokenFactory.deploy("TokenA", "TA", parseUnits("10000000", 18));
    underlyingERC20TokenB = await UnderlyingTokenFactory.deploy("TokenB", "TB", parseUnits("10000000", 18));
    await underlyingERC20TokenA.deployed();
    await underlyingERC20TokenB.deployed();


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
    cErc20TokenA = await CErc20ImmutableFactory.deploy(
        underlyingERC20TokenA.address,
        comptroller.address,
        whitePaperInterestRate.address,
        parseUnits("1", 18),
        "CTokenA",
        "CTA",
        18,
        owner.address
    );
    cErc20TokenA.deployed();

    cErc20TokenB = await CErc20ImmutableFactory.deploy(
        underlyingERC20TokenB.address,
        comptroller.address,
        whitePaperInterestRate.address,
        parseUnits("1", 18),
        "CTokenB",
        "CTB",
        18,
        owner.address
    );
    cErc20TokenB.deployed();


    comptroller._supportMarket(cErc20TokenA.address);
    comptroller._supportMarket(cErc20TokenB.address);

    // 使用 proxy contract 要注意 initialize 會有兩個（CErc20、CToken 各有），因此要用 signature 來選 initialize method
    // CErc20["initialize(address,address,address,uint256,string,string,uint8)"](
    //     underlyingERC20TokenA.address,
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

    return {
        owner,
        userA,
        userB,
        underlyingERC20TokenA,
        underlyingERC20TokenB,
        comptroller,
        whitePaperInterestRate,
        cErc20TokenA,
        cErc20TokenB,
        simplePriceOracle,
    };
}

async function setUpBorrowRepayContext() {
    const {
        userA,
        userB,
        underlyingERC20TokenA,
        underlyingERC20TokenB,
        comptroller,
        cErc20TokenA,
        cErc20TokenB,
        simplePriceOracle,
    } = await loadFixture(deployContractsFixture);

    // Oracle 設定 cTokenA 的價格為 $1
    const setAPriceTx = await simplePriceOracle.setUnderlyingPrice(cErc20TokenA.address, parseUnits("1", 18));
    const receiptAPrice = (await setAPriceTx.wait()).events?.[0].args;
    expect(receiptAPrice?.previousPriceMantissa).to.equal(0);
    expect(receiptAPrice?.newPriceMantissa).to.equal(parseUnits("1", 18));

    // Oracle 設定 cTokenB 的價格為 $100
    const setBPriceTx = await simplePriceOracle.setUnderlyingPrice(cErc20TokenB.address, parseUnits("100", 18));
    const receiptBPriceEvents = (await setBPriceTx.wait()).events?.[0].args;
    expect(receiptBPriceEvents?.previousPriceMantissa).to.equal(0);
    expect(receiptBPriceEvents?.newPriceMantissa).to.equal(parseUnits("100", 18));

    // 設定 cTokenB 的抵押率
    const setBCollateralTx = await comptroller._setCollateralFactor(cErc20TokenB.address, parseUnits("0.5", 18));
    const receiptBCollateralTxEvents = (await setBCollateralTx.wait()).events?.[0].args;
    expect(receiptBCollateralTxEvents?.oldCollateralFactorMantissa).to.equal(0);
    expect(receiptBCollateralTxEvents?.newCollateralFactorMantissa).to.equal(parseUnits("0.5", 18));

    // 發 underlyingERC20TokenB 錢給 userA 好讓 userA 放貸 cTokenB
    await underlyingERC20TokenB.transfer(userA.address, parseUnits("1", 18));
    // 發 underlyingERC20TokenA 錢給 userB 好讓 userB 放貸 cTokenA
    await underlyingERC20TokenA.transfer(userB.address, parseUnits("100", 18));

    // 檢查 userA, userB 是否有轉到錢
    expect(await underlyingERC20TokenB.balanceOf(userA.address)).to.equal(parseUnits("1", 18));
    expect(await underlyingERC20TokenA.balanceOf(userB.address)).to.equal(parseUnits("100", 18));

    await underlyingERC20TokenB.connect(userA).approve(cErc20TokenB.address, parseUnits("1", 18));
    await underlyingERC20TokenA.connect(userB).approve(cErc20TokenA.address, parseUnits("100", 18));
    // 會有三個 event 可以去觀察 AccrueInterest、Mint、Transfer
    const mintCTokenBTx = await cErc20TokenB.connect(userA).mint(parseUnits("1", 18));
    const receiptMintCTokenBTxMintEvent = (await mintCTokenBTx.wait()).events?.find(e=> e.event == 'Mint');
    expect(receiptMintCTokenBTxMintEvent?.args?.mintTokens).to.equal(parseUnits("1", 18));
    await cErc20TokenA.connect(userB).mint(parseUnits("100", 18));

    // userA 用 cTokenB 為抵押，好讓 userA 能借貸
    await comptroller.connect(userA).enterMarkets([cErc20TokenB.address]);

    // 借款
    expect(await cErc20TokenA.getCash()).to.equal(parseUnits("100", 18)); // 檢查是否有 100 顆 cTokenA
    const borrowTx = await cErc20TokenA.connect(userA).borrow(parseUnits("50", 18));
    const receiptBorrowTxEvent = (await borrowTx.wait()).events?.find(e => e.event == 'Borrow')?.args;
    expect(receiptBorrowTxEvent?.borrowAmount).to.equal(parseUnits("50", 18));
    expect(await cErc20TokenA.getCash()).to.equal(parseUnits("50", 18)); // 檢查是否有 50 顆 cTokenA

    // 檢查借款狀態是否健康
    await printAccountLiquidity(userA.address, comptroller);

    return {
        userA,
        userB,
        underlyingERC20TokenA,
        underlyingERC20TokenB,
        cErc20TokenA,
        cErc20TokenB,
        simplePriceOracle,
        comptroller
    }
}


describe("Test mint and redeem", function () {
    it("Should be able to mint and redeem with underlyingToken", async () => {
        const { userA, underlyingERC20TokenA, cErc20TokenA, } = await loadFixture(deployContractsFixture);

        // userA 先要有些錢才能 mint 出 cErc20TokenA
        await underlyingERC20TokenA.transfer(userA.address, parseUnits("100", 18));
        expect(await underlyingERC20TokenA.balanceOf(userA.address)).to.equal(parseUnits("100", 18));

        // mint
        await underlyingERC20TokenA.connect(userA).approve(cErc20TokenA.address, parseUnits("100", 18));
        await cErc20TokenA.connect(userA).mint(parseUnits("100", 18));
        expect(await cErc20TokenA.balanceOf(userA.address)).to.equal(parseUnits("100", 18));

        // redeem
        const userABalance = await cErc20TokenA.balanceOf(userA.address);
        expect(userABalance).to.equal(parseUnits("100", 18));
        await cErc20TokenA.connect(userA).redeem(userABalance.toString());
        expect(await cErc20TokenA.balanceOf(userA.address)).to.equal(0);
    });
});


describe("Test borrow and liquidation", function () {
    it("Should be able to borrow", async () => {
        await loadFixture(setUpBorrowRepayContext);
    });

    it("Modify token collateral factor, make userA liquidation", async () => {
        const {
            userA,
            userB,
            underlyingERC20TokenA,
            cErc20TokenA,
            cErc20TokenB,
            comptroller
        } = await loadFixture(setUpBorrowRepayContext);

        await comptroller._setLiquidationIncentive(parseUnits("1", 18)); // 清算人的獎勵
        await comptroller._setCloseFactor(parseUnits("0.5", 18)); // 可清算 token 的比例
        await comptroller._setCollateralFactor(cErc20TokenB.address, parseUnits("0.2", 18));
        console.log('after modify collateral factor'.bgMagenta);
        await printAccountLiquidity(userA.address, comptroller);

        await underlyingERC20TokenA.transfer(userB.address, parseUnits("20", 18));
        await underlyingERC20TokenA.connect(userB).approve(cErc20TokenA.address, parseUnits("20", 18));

        //                              要償還的 cToken       幫償還的人               被清算的人       清算數量              想拿到的 cToken
        const liquidateBorrowTx = await cErc20TokenA.connect(userB).liquidateBorrow(userA.address, parseUnits("20", 18), cErc20TokenB.address);
        const liquidateBorrowEventInfo = (await liquidateBorrowTx.wait()).events?.reduce((map, cur) => {
            return cur?.event && !map.has(cur.event) && map.set(cur.event, cur.args), map;
        }, new Map);
        console.log('modify collateral factor result info'.bgYellow);
        console.log(liquidateBorrowEventInfo);

    })

    it("Use an oracle to modify the tokenB price and make userA liquidation", async () => {
        const {
            userA,
            userB,
            underlyingERC20TokenA,
            cErc20TokenA,
            cErc20TokenB,
            comptroller,
            simplePriceOracle,
        } = await loadFixture(setUpBorrowRepayContext);

        await simplePriceOracle.setUnderlyingPrice(cErc20TokenB.address, parseUnits("30", 18));
        await comptroller._setLiquidationIncentive(parseUnits("1", 18));
        await comptroller._setCloseFactor(parseUnits("0.5", 18));
        console.log('after modify collateral factor'.bgMagenta);
        await printAccountLiquidity(userA.address, comptroller);

        await underlyingERC20TokenA.transfer(userB.address, parseUnits("20", 18));
        await underlyingERC20TokenA.connect(userB).approve(cErc20TokenA.address, parseUnits("20", 18));

        // //                            要償還的 cToken.     幫償還的人               被清算的人       清算數量               想拿到的 cToken
        const liquidateBorrowTx = await cErc20TokenA.connect(userB).liquidateBorrow(userA.address, parseUnits("20", 18), cErc20TokenB.address);
        const liquidateBorrowEventInfo = (await liquidateBorrowTx.wait()).events?.reduce((map, cur) => {
            return cur?.event && !map.has(cur.event) && map.set(cur.event, cur.args), map;
        }, new Map);
        console.log('modify tokenB price result info'.bgYellow);
        console.log(liquidateBorrowEventInfo);
    });
});