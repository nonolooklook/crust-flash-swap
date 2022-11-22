import { Injectable, OnDestroy } from '@angular/core';
import { ethers } from 'ethers';
import { ToastrService } from 'ngx-toastr';
import { BehaviorSubject, from, Observable } from 'rxjs';
import { AppStateService, LoginMethod } from './app-state.service';
import { createWallet } from './wallets/factory';
import { Wallet } from './wallets/wallet';

function isNotMetaMask() {
  const ethereum = (window as any).ethereum;
  return !ethereum || ethereum.isOKExWallet || ethereum.isOkxWallet;
}
@Injectable({
  providedIn: 'root',
})
export class WalletService implements OnDestroy {
  accounts$: BehaviorSubject<string[]> = new BehaviorSubject<string[]>([]);
  chainId$: BehaviorSubject<number> = new BehaviorSubject<number>(1);
  provider?: ethers.providers.Web3Provider;
  pendingCommands = false;
  wallet?: Wallet;

  constructor(private appState: AppStateService, private toast: ToastrService) {
    const lm = appState.getLoginMethod();

    if (lm !== LoginMethod.NotLogIn) {
      if (!(lm === LoginMethod.MetaMask && isNotMetaMask())) {
        this.wallet = createWallet(lm);
      }
      if (this.wallet)
        this.wallet
          .init()
          .then((w) => {
            w.accounts$.subscribe(this.accounts$);
            w.chainId$.subscribe(this.chainId$);
          })
          .catch(console.info);
    }
    appState.getLoginMethodOb().subscribe((lm) => {
      if (lm === LoginMethod.NotLogIn && this.wallet) {
        this.wallet.destory();
        this.wallet = undefined;
        this.accounts$.next([]);
      }
    });
  }

  ngOnDestroy(): void {
    this.accounts$.unsubscribe();
    this.chainId$.unsubscribe();
    if (this.wallet) {
      this.wallet.destory();
      this.wallet = undefined;
    }
  }

  public getCoinBalance(account: string, coin: CryptoAsset): Promise<number> {
    return this.wallet?.balance(account, coin) || Promise.resolve(0);
  }

  public getAccountObs(): BehaviorSubject<string[]> {
    return this.accounts$;
  }

  public getChainIdObs(): Observable<number> {
    return this.chainId$;
  }

  public connectWallet(
    loginMethod: LoginMethod = LoginMethod.MetaMask
  ): Observable<void> {
    if (loginMethod === LoginMethod.MetaMask && isNotMetaMask()) {
      this.toast.error('Please install MetaMask!');
      return from([]);
    }
    if (loginMethod === LoginMethod.Okx && !(window as any).okxwallet) {
      this.toast.error('Please install OKX Wallet!');
      return from([]);
    }
    if (this.wallet && this.wallet.type !== loginMethod) {
      this.wallet.destory();
      this.wallet = undefined;
    }
    if (!this.wallet) this.wallet = createWallet(loginMethod);
    if (!this.wallet) return from([]);
    return from(
      this.wallet
        .init()
        .then((w) => {
          w.accounts$.subscribe(this.accounts$);
          w.chainId$.subscribe(this.chainId$);
          return w;
        })
        .then((w) => w.connect())
        .then(() => this.appState.setLoginMethod(loginMethod))
        .catch(console.error)
    );
  }

  public composeSend(
    fromAsset: CryptoAsset,
    toAddress: string,
    amount: number
  ): Observable<any> {
    return this.wallet?.composeSend(fromAsset, toAddress, amount) || from([]);
  }
}
