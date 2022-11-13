// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "../compound/CErc20.sol";
import "./interfaces/AAVE/FlashLoanReceiverBase.sol";
import "./interfaces/AAVE/ILendingPool.sol";
import "./interfaces/AAVE/ILendingPoolAddressesProvider.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "hardhat/console.sol";

contract FlashLoanReceiver is FlashLoanReceiverBase {
    event AmountOut(uint256 amountOut);
    event AmountOwing(uint256 amountOwing);

    ISwapRouter public immutable swapRouter;

    constructor(
        ILendingPoolAddressesProvider _addressProvider,
        ISwapRouter _swapRouter
    ) FlashLoanReceiverBase(_addressProvider) {
        swapRouter = ISwapRouter(_swapRouter);
    }

    /**
        This function is called after your contract has received the flash loaned amount
    */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        (
            address borrower,
            address cTokenLiquidateAddress,
            address cTokenRewardAddress,
            address ercTokenRewardAddress
        ) = abi.decode(params, (address, address, address, address));

        {
            address usdc = assets[0];
            uint256 repayAmount = amounts[0];

            IERC20(usdc).approve(cTokenLiquidateAddress, repayAmount);

            // 清算借款人的債務
            CErc20(cTokenLiquidateAddress).liquidateBorrow(
                borrower,
                repayAmount,
                CErc20(cTokenRewardAddress)
            );

            // 贖回 tokens 數量
            uint256 redeemTokens = IERC20(cTokenRewardAddress).balanceOf(
                address(this)
            );

            // 贖回獎勵
            CErc20(cTokenRewardAddress).redeem(redeemTokens);

            uint256 rewardBalances = IERC20(ercTokenRewardAddress).balanceOf(
                address(this)
            );

            IERC20(ercTokenRewardAddress).approve(
                address(swapRouter),
                rewardBalances
            );

            // Naively set amountOutMinimum to 0. In production, use an oracle or other data source to choose a safer value for amountOutMinimum.
            // We also set the sqrtPriceLimitx96 to be 0 to ensure we swap our exact input amount.
            ISwapRouter.ExactInputSingleParams memory uniSwapparams = ISwapRouter
                .ExactInputSingleParams({
                    tokenIn: ercTokenRewardAddress,
                    tokenOut: usdc,
                    fee: 3000, // set the pool fee to 0.3%.
                    recipient: address(this),
                    deadline: block.timestamp,
                    amountIn: rewardBalances,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                });

            // The call to `exactInputSingle` executes the swap.
            uint256 amountOut = swapRouter.exactInputSingle(uniSwapparams);
            emit AmountOut(amountOut);
        }

        // Approve the LendingPool contract allowance to *pull* the owed amount
        for (uint256 i = 0; i < assets.length; i++) {
            // 最後 contract 會欠 flashLoan amounts + premiums.
            // 所以我們要確認有足夠的 amounts 來償還
            uint256 amountOwing = amounts[i] + premiums[i];
            IERC20(assets[i]).approve(address(LENDING_POOL), amountOwing);
            emit AmountOwing(amountOwing);
        }

        return true;
    }

    function flashLoan(
        address[] calldata _assets,
        uint256[] calldata _amounts,
        bytes calldata _params
    ) external {
        address receiverAddress = address(this);

        // 0 = no debt, 1 = stable, 2 = variable
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0; // 支付所有貸款

        address onBehalfOf = address(this);
        uint16 referralCode = 0;

        LENDING_POOL.flashLoan(
            receiverAddress,
            _assets,
            _amounts,
            modes,
            onBehalfOf,
            _params,
            referralCode
        );
    }
}
