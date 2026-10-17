export enum FailureCode {
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  CurrencyMismatch = 'CURRENCY_MISMATCH',
  WalletNotFound = 'WALLET_NOT_FOUND',
  ReferenceRequired = 'REFERENCE_REQUIRED',
  ReferenceNotFound = 'REFERENCE_NOT_FOUND',
  ReferenceMismatch = 'REFERENCE_MISMATCH',
  ReferenceNotReversible = 'REFERENCE_NOT_REVERSIBLE',
  AlreadyReversed = 'ALREADY_REVERSED',
  AmountMismatch = 'AMOUNT_MISMATCH',
  ReversalWouldGoNegative = 'REVERSAL_WOULD_GO_NEGATIVE',
  InvalidState = 'INVALID_STATE',
  InternalError = 'INTERNAL_ERROR',
}
