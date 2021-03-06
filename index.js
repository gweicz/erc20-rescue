const fs = require('fs')
const yaml = require('js-yaml')
const Web3 = require('web3')
const BigNumber = require('bignumber.js')
const HDWalletProvider = require('@truffle/hdwallet-provider')
const ERC20_ABI = require('./ERC20')

const file = process.argv[2]
if (!file) {
  console.error("Please specify config file:\nFor example: $ ./eth-rescue config.yaml")
  process.exit(1)
}

const gasPrice = process.argv[3] 

const config = yaml.load(fs.readFileSync(file))

class RescueApp { 

  constructor () {
    this.currentBalance = 0
    this.lookingForBalance = true
    this.resended = false
    this.numTokens = config.tokens.length
    this.txs = {}
    this.source = null
  }

  async balance (token = null) {
    return this.web3.eth.getBalance(this.source)
  }

  erc20 (addr) {
    return new this.web3.eth.Contract(ERC20_ABI, addr)
  }

  async init () {
    const wsProvider = new Web3.providers.WebsocketProvider(config.ethNode)
    HDWalletProvider.prototype.on = wsProvider.on.bind(wsProvider)

    const pc = {
      providerOrUrl: wsProvider
    }
    if (config.mnemonic) {
      pc.mnemonic = { phrase: config.mnemonic }
    }
    if (config.privateKey) {
      pc.privateKeys = [config.privateKey]
    }
    const provider = this.provider = new HDWalletProvider(pc)

    this.web3 = new Web3(provider)
    const acc = await this.web3.eth.getAccounts()
    this.source = acc[0]

    this._ = this.web3.utils
    const currentGasPrice = this._.fromWei(await this.web3.eth.getGasPrice(), 'gwei')
    this.gasPrice = this._.toWei(gasPrice ? String(gasPrice) : currentGasPrice, 'gwei')
    this.currentBalance = await this.balance()

    console.log(`Address: ${this.source}`)
    console.log(`Balance: ${this._.fromWei(this.currentBalance)} ETH`)
    console.log(`Gas price: ${this._.fromWei(this.gasPrice, 'gwei')} gwei`)
    console.log(`Provider default gas price: ${currentGasPrice} gwei`)
    await this.subscribe()
    //await this.resend()
    //await this.resendRestETH()
  }

  async subscribe () {
    console.log('Waiting for new ETH balance ...')
    this.web3.eth.subscribe('newBlockHeaders', async (err, data) => {
      if (err) {
        console.error(err)
        return
      }
      const bal = await this.balance()
      console.log(`New block ${data.number}`)
      if (this.lookingForBalance && bal !== this.currentBalance) {
        console.log(`Balance changed!! => ${this._.fromWei(bal)}`)
        this.resend()
      }
      this.currentBalance = bal
      if (this.resended) {
        let done = true
        for (const tx of Object.keys(this.txs)) {
          if (this.txs[tx]) {
            continue
          }
          this.txs[tx] = await this.web3.eth.getTransactionReceipt(tx)
          if (this.txs[tx]) {
            console.log(`Transaction ${tx} confirmed`)
          } else {
            done = false
          }
        }
        if (done) {
          console.log('Tokens succefully resended. Resending rest of ETH ...')
          this.resendRestETH()
        }
      }
    })
  }

  async resendRestETH () {
    if (this.currentBalance === "0") {
      console.log('Account it empty. No ETH. Exiting..')
      process.exit()
    }
    const BN = this._.BN
    const gas = new BN('21000')
    const cost = gas.mul(new BN(this.gasPrice))
    const sendAmount = new BN(this.currentBalance).sub(cost)

    this.web3.eth.sendTransaction({
      from: this.source,
      to: config.target,
      gas: gas,
      gasPrice: new BN(this.gasPrice),
      value: sendAmount
    }, (err, txid) => {

      console.log(`${this._.fromWei(sendAmount)} ETH sended: ${txid}`)
      console.log('All done.')
      process.exit()
    })
  }

  async resend () {
    this.lookingForBalance = false
    let nonce = await this.web3.eth.getTransactionCount(this.source, "pending")
    await Promise.all(config.tokens.map(async (token, n) => {
      return new Promise(resolve => {
        const tx = this.erc20(token.addr).methods.transfer(config.target, this._.toWei(token.amount)).send({ from: this.source, nonce: nonce + n, gasPrice: this.gasPrice }, (err, txHash) => {
          this.txs[txHash] = null

          if (err) {
            console.error(err)
          } else {
            console.log(`Token sended! ${token.symbol} ${token.amount} [${txHash}]`)
          }
          resolve()
        })
      })
    }))
    this.resended = true
    console.log('Tokens sended. Waiting for confirmations..')
  }
}


const app = new RescueApp()
app.init()

