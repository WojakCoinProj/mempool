import { Pipe, PipeTransform } from '@angular/core';
import { getNativeAssetSymbol } from '@app/shared/native-asset.utils';

@Pipe({
  name: 'nativeAssetSymbol',
  standalone: false,
})
export class NativeAssetSymbolPipe implements PipeTransform {
  transform(_value?: unknown): string {
    return getNativeAssetSymbol();
  }
}
