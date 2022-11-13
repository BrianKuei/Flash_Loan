# Flash Loan

撰寫 Compound test

執行專案前請先新增 .env 檔案並在檔案中新增:

```env
ALCHEMY_KEY="past your alchemy key"
```

完成 env 設定後在 terminal 中輸入:

```shell
npm install --force
npx hardhat compile

Q1~Q5:
npx hardhat test ./test/Compound_test.ts

Q6:
npx hardhat test ./test/Flashloan_test.ts 

```
