import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { Subscription } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { getNativeAssetSymbol } from '@app/shared/native-asset.utils';

@Component({
  selector: 'app-btc',
  templateUrl: './btc.component.html',
  styleUrls: ['./btc.component.scss'],
  standalone: false,
})
export class BtcComponent implements OnInit, OnChanges {
  @Input() satoshis: number;
  @Input() addPlus = false;
  @Input() valueOverride: string | undefined = undefined;

  value: number;
  unit: string;

  network = '';
  stateSubscription: Subscription;

  constructor(
    private stateService: StateService,
  ) { }

  ngOnInit() {
    this.stateSubscription = this.stateService.networkChanged$.subscribe((network) => this.network = network);
  }

  ngOnDestroy() {
    if (this.stateSubscription) {
      this.stateSubscription.unsubscribe();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    const nativeSymbol = getNativeAssetSymbol();
    if (this.satoshis >= 1_000_000) {
      this.value = (this.satoshis / 100_000_000);
      this.unit = nativeSymbol;
    } else {
      this.value = Math.round(this.satoshis);
      this.unit = 'sats';
    }
  }
}
