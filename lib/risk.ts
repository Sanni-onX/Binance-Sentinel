import Decimal from 'decimal.js';
import { HttpError } from './errors';
export function checkOrderBudget(
  amount: string,
  freeUSDT: string,
  total: number,
  currentAssetValue: number,
  maxOrder = 25,
) {
  const spend = new Decimal(amount);
  if (!spend.isFinite() || spend.lte(0) || spend.gt(maxOrder))
    throw new HttpError(
      400,
      `Order must be above zero and at most ${maxOrder} USDT.`,
    );
  if (spend.gt(new Decimal(freeUSDT).mul(0.98)))
    throw new HttpError(
      400,
      'Insufficient available USDT including a fee reserve.',
    );
  if (total <= 0 || spend.gt(new Decimal(total).mul(0.05)))
    throw new HttpError(400, 'Order exceeds 5% of the priced portfolio.');
  if (new Decimal(freeUSDT).minus(spend).lt(new Decimal(total).mul(0.2)))
    throw new HttpError(
      400,
      'Order would reduce available USDT below the 20% reserve.',
    );
  if (
    new Decimal(currentAssetValue).plus(spend).gt(new Decimal(total).mul(0.5))
  )
    throw new HttpError(
      400,
      'Order would exceed the 50% single-asset exposure limit.',
    );
}
