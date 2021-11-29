import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { FormControl } from '@angular/forms';
import * as _ from 'lodash';
import { interval, Subject, Subscription } from 'rxjs';
import {
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  map,
  switchMap,
  tap,
} from 'rxjs/operators';
import { ERC20__factory } from 'src/typechain/factories/ERC20__factory';
import { KeyringService } from '../keyring.service';
import { SwftService } from '../swft.service';
import { WalletService } from '../wallet.service';

const defaultAssets: CryptoAsset[] = [
  {
    symbol: 'ETH',
    // chainId: 1,
    network: 'ETH',
    decimal: 18,
  },
];

const CRU: CryptoAsset = {
  symbol: 'USDT',
  network: 'ETH',
  // chainId: 0,
  contract: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  decimal: 6,
};

const TradeMarkets: Market[] = [
  {
    name: 'Houbi',
    imageUrl: '/assets/ht.svg',
    url: 'https://www.huobi.com',
  },
  {
    name: 'Uniswap',
    imageUrl: '/assets/uniswap.svg',
    url: 'https://app.uniswap.com',
  },
  {
    name: 'Gateio',
    imageUrl: '/assets/gateio.svg',
    url: 'https://www.gate.io',
  },
  {
    name: 'ZB.COM',
    imageUrl: '/assets/zbg.svg',
    url: 'https://zb.com',
  },
  {
    name: 'Coinone',
    imageUrl: '/assets/coinone.svg',
    url: 'https://coinone.co.kr',
  },
  {
    name: 'Hotbit',
    imageUrl: '/assets/hotbit.svg',
    url: 'https://hotbit.io',
  },
  {
    name: 'BitMart',
    imageUrl: '/assets/bitmart.svg',
    url: 'https://bitmart.com',
  },
];

@Component({
  selector: 'app-flash-swap',
  templateUrl: './flash-swap.component.html',
  styleUrls: ['./flash-swap.component.scss'],
})
export class FlashSwapComponent implements OnInit, OnDestroy {
  markets = TradeMarkets;

  selectedAsset: CryptoAsset = defaultAssets[0];
  cru = CRU;
  account: string | null = null;
  allCoinList: CoinInfo[] = [];
  fromCoinList: CryptoAsset[] = defaultAssets;

  coinListLoadStatus: CoinListStatus = 'loading';

  fromAmount = new FormControl('');
  toAddress = new FormControl('');
  toAmount = 0;
  selectAssetSubject$ = new Subject<CryptoAsset>();
  subAccount$ = new Subscription();
  subFromAmount$ = new Subscription();
  subCoinList$ = new Subscription();
  errors: { [k: string]: boolean } = {};

  priceInfo?: PriceInfo;
  loadPriceError = false;

  constructor(
    private wallet: WalletService,
    private swft: SwftService,
    private keyring: KeyringService
  ) {}

  ngOnInit(): void {
    this.subAccount$ = this.wallet.getAccountObs().subscribe(
      (accts) => {
        this.account = _.isEmpty(accts) ? null : accts[0];
      },
      (e) => {
        console.error('error getting account', e);
      }
    );

    this.subFromAmount$ = this.fromAmount.valueChanges
      .pipe(distinctUntilChanged(), debounceTime(50))
      .subscribe((v) => {
        if (v > 0) {
          this.errors = _.omit(this.errors, 'fromAmount');
        }
        console.log('v ', v);
      });

    this.subCoinList$ = this.swft.getCoinList().subscribe(
      (result) => {
        if (result.resCode !== '800') {
          this.coinListLoadStatus = 'error';
          return;
        }
        this.coinListLoadStatus = 'loaded';
        this.allCoinList = result.data;
        this.fromCoinList = _.chain(this.allCoinList)
          .filter((c) => {
            const currentCoinCode = this.cru.symbol;
            const unsupported =
              _.findIndex(c.noSupportCoin.split(','), currentCoinCode) >= 0;
            return !unsupported;
          })
          .map((v) => {
            if (v.mainNetwork !== 'ETH') {
              return null;
            }
            return {
              symbol: v.coinCode,
              network: v.mainNetwork,
              contract: v.contract || '',
              decimal: v.coinDecimal,
            };
          })
          .filter()
          .value() as CryptoAsset[];
        this.selectItem(this.fromCoinList[0]);
      },
      () => {
        this.coinListLoadStatus = 'error';
      }
    );

    this.toAddress.valueChanges
      .pipe(distinctUntilChanged(), debounceTime(50))
      .subscribe(
        (v) => {
          if (this.isToAddressValid(v)) {
            this.errors = _.omit(this.errors, 'toAddress');
          }
        },
        (e) => {
          console.error('failed handle value changes', e);
        }
      );

    this.selectAssetSubject$
      .asObservable()
      .pipe(
        combineLatest(this.fromAmount.valueChanges),
        distinctUntilChanged(),
        debounceTime(50)
      )
      .pipe(combineLatest(interval(10 * 1000))) // 每10秒更新一次报价
      .pipe(
        tap(() => (this.loadPriceError = false)),
        switchMap(([[assetSelected, fromAmount]]) => {
          return this.swft
            .getPriceInfo(assetSelected, this.cru)
            .pipe(map((v) => [v, fromAmount]));
        })
      )
      .subscribe(
        ([result, fromAmount]) => {
          if (result.resCode !== '800') {
            this.loadPriceError = true;
            return;
          }
          this.loadPriceError = false;
          this.priceInfo = result.data;
          this.toAmount = this.swft.getReturnAmount(
            fromAmount,
            this.priceInfo!
          );
          // console.log('asset, amount, to', this.priceInfo, this.toAmount);
        },
        (e) => {
          console.error('error handling price update', e);
        }
      );

    this.selectAssetSubject$.next(this.selectedAsset);
  }

  ngOnDestroy(): void {
    this.subAccount$.unsubscribe();
    this.subFromAmount$.unsubscribe();
    this.subCoinList$.unsubscribe();
  }

  public selectItem(item: CryptoAsset): void {
    this.selectedAsset = item;
    this.selectAssetSubject$.next(item);
    // this.itemSelected.emit(item);
  }

  public isConnected(): boolean {
    return this.account !== null && this.account.length > 0;
  }

  public getConnectedAddress(): string | null {
    return this.account;
  }

  public getShortAddress(): string | null {
    const addr = this.getConnectedAddress();
    if (!addr) {
      return null;
    }

    return addr.substring(0, 5) + '...' + addr.substring(addr.length - 5);
  }

  public connectWallet(): void {
    this.wallet.connectWallet().subscribe(
      () => {},
      (e) => {
        console.log('error connecting to wallet');
      }
    );
  }

  public getImageUrl(a: CryptoAsset): string {
    return `https://www.swftc.info/swft-v3/images/coins/${a.symbol}.png`;
  }

  public doSwap(): void {
    this.errors = {};
    if (!this.fromAmount.value || this.fromAmount.value <= 0) {
      this.errors['fromAmount'] = true;
    }
    if (!this.toAddress.value || !this.isToAddressValid(this.toAddress.value)) {
      this.errors['toAddress'] = true;
    }
    if (!this.priceInfo) {
      this.errors['price'] = true;
      return;
    }
  }

  private isToAddressValid(addr: string): boolean {
    return this.keyring.isAddressValid(addr);
  }
}
