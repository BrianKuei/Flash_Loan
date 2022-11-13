import "colors";
import { Comptroller } from "@/typechain-types";
import * as dotenv from 'dotenv'
dotenv.config()

export async function printAccountLiquidity(
  accountAddress: string,
  comptroller: Comptroller
) {
  const [_, collateral, shortfall] = await comptroller.getAccountLiquidity(
      accountAddress
  );

  if (shortfall.isZero()) {
      console.log(
          "Healthy".green,
          "collateral=",
          collateral.toString().green,
          "shortfall=",
          shortfall.toString().green
      );
  } else {
      console.log(
          "Underwater !!!".red,
          "collateral=",
          collateral.toString().red,
          "shortfall=",
          shortfall.toString().red
      );
  }

  return shortfall;
}
