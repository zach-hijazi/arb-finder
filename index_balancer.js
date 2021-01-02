// Example showing full swapExactIn - run using: $ ts-node ./test/testScripts/example-swapExactIn.ts
require('dotenv').config();
const sor = require('../../src');
const BigNumber = require('bignumber.js');
//import { JsonRpcProvider } from '@ethersproject/providers';


const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F'; // DAI Address
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC Address
const amountIn = new BigNumber('1000000'); // 1 USDC, Always pay attention to Token Decimals. i.e. In this case USDC has 6 decimals.
const tokenIn = USDC;
const tokenOut = DAI;
const swapType = 'swapExactIn';
const noPools = 4; // This determines how many pools the SOR will use to swap.
const gasPrice = new BigNumber('30000000000'); // You can set gas price to whatever the current price is.
const swapCost = new BigNumber('100000'); // A pool swap costs approx 100000 gas
// URL for pools data
const poolsUrl = `https://ipfs.fleek.co/ipns/balancer-team-bucket.storage.fleek.co/balancer-exchange-kovan/pools`;

const provider = new Web3(process.env.UNI_RPC_URL)

async function swapExactIn() {
    // This calculates the cost in output token (output token is tokenOut for swapExactIn and
    // tokenIn for a swapExactOut) for each additional pool added to the final SOR swap result.
    // This is used as an input to SOR to allow it to make gas efficient recommendations, i.e.
    // if it costs 5 DAI to add another pool to the SOR solution and that only generates 1 more DAI,
    // then SOR should not add that pool (if gas costs were zero that pool would be added)
    const costOutputToken = await sor.getCostOutputToken(
        DAI,
        gasPrice,
        swapCost,
        provider
    );

    // Fetch all pools information
    const poolsHelper = new sor.POOLS();
    console.log('Fetching Pools...');
    let allPoolsNonZeroBalances = await poolsHelper.getAllPublicSwapPools(
        poolsUrl
    );

    console.log(`Retrieving Onchain Balances...`);
    allPoolsNonZeroBalances = await sor.getAllPoolDataOnChain(
        allPoolsNonZeroBalances,
        '0x514053acec7177e277b947b1ebb5c08ab4c4580e', // Address of Multicall contract
        provider
    );

    console.log(`Processing Data...`);
    // 'directPools' are all pools that contain both tokenIn and tokenOut, i.e. pools that
    // can be used for direct swaps
    // 'hopTokens' are all tokens that can connect tokenIn and tokenOut in a multihop swap
    // with two legs. WETH is a hopToken if its possible to trade USDC to WETH then WETH to DAI
    // 'poolsTokenIn' are the pools that contain tokenIn and a hopToken
    // 'poolsTokenOut' are the pools that contain a hopToken and tokenOut
    let directPools, hopTokens, poolsTokenIn, poolsTokenOut;
    [directPools, hopTokens, poolsTokenIn, poolsTokenOut] = sor.filterPools(
        allPoolsNonZeroBalances.pools,
        tokenIn.toLowerCase(), // The Subgraph returns tokens in lower case format so we must match this
        tokenOut.toLowerCase(),
        noPools
    );

    // For each hopToken, find the most liquid pool for the first and the second hops
    let mostLiquidPoolsFirstHop, mostLiquidPoolsSecondHop;
    [
        mostLiquidPoolsFirstHop,
        mostLiquidPoolsSecondHop,
    ] = sor.sortPoolsMostLiquid(
        tokenIn,
        tokenOut,
        hopTokens,
        poolsTokenIn,
        poolsTokenOut
    );

    // Finds the possible paths to make the swap, each path can be a direct swap
    // or a multihop composed of 2 swaps
    let pools, pathData;
    [pools, pathData] = sor.parsePoolData(
        directPools,
        tokenIn.toLowerCase(),
        tokenOut.toLowerCase(),
        mostLiquidPoolsFirstHop,
        mostLiquidPoolsSecondHop,
        hopTokens
    );

    // For each path, find its spot price, slippage and limit amount
    // The spot price of a multihop is simply the multiplication of the spot prices of each
    // of the swaps. The slippage of a multihop is a bit more complicated (out of scope for here)
    // The limit amount is due to the fact that Balancer protocol limits a trade to 50% of the pool
    // balance of tokenIn (for swapExactIn) and 33.33% of the pool balance of tokenOut (for
    // swapExactOut)
    // 'paths' are ordered by ascending spot price
    let paths = sor.processPaths(pathData, pools, swapType);

    // epsOfInterest stores a list of all relevant prices: these are either
    // 1) Spot prices of a path
    // 2) Prices where paths cross, meaning they would move to the same spot price after trade
    //    for the same amount traded.
    // For each price of interest we have:
    //   - 'bestPathsIds' a list of the id of the best paths to get to this price and
    //   - 'amounts' a list of how much each path would need to trade to get to that price of
    //     interest
    let epsOfInterest = sor.processEpsOfInterestMultiHop(
        paths,
        swapType,
        noPools
    );

    // Returns 'swaps' which is the optimal list of swaps to make and
    // 'totalReturnWei' which is the total amount of tokenOut (eg. DAI) will be returned
    let swaps, totalReturnWei;
    [swaps, totalReturnWei] = sor.smartOrderRouterMultiHopEpsOfInterest(
        pools,
        paths,
        swapType,
        amountIn,
        noPools,
        costOutputToken,
        epsOfInterest
    );

    console.log(`Total DAI Return: ${totalReturnWei.toString()}`);
    console.log(`Swaps: `);
    console.log(swaps);
}

swapExactIn();
