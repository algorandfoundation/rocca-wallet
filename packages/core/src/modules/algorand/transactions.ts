import {
  decodeTransaction,
  encodeSignedTransaction,
  encodeTransaction,
  groupTransactions,
  PaymentTransactionFields,
  SignedTransaction,
  Transaction,
  TransactionParams,
  TransactionType,
} from '@algorandfoundation/algokit-utils/transact';

import { Address, AlgorandClient } from '@algorandfoundation/algokit-utils'
import { decode as cborDecode, encode as cborEncode } from 'cbor-x'
import { v4 as uuidv4 } from 'uuid'
import { toBase64URL, fromBase64Url } from '@algorandfoundation/liquid-client'
import { PostTransactionsResponse } from '@algorandfoundation/algokit-utils/packages/algod_client/src/models/post-transactions-response';





// 

export const createGroupTxnToSign = async (rocca_address: string, pawn_address: string): Promise<Transaction[]> => {

  const algorand = await AlgorandClient.testNet();

  const suggested_params = await algorand.getSuggestedParams();

  const pay1: PaymentTransactionFields = {
    amount: 0n,
    receiver: Address.fromString(rocca_address),
  }

  const txnFields1: TransactionParams = {
    type: TransactionType.Payment,
    payment: pay1,
    sender: Address.fromString(pawn_address),
    fee: 2n * suggested_params.minFee,
    firstValid: suggested_params.firstValid,
    lastValid: suggested_params.lastValid,
    genesisHash: suggested_params.genesisHash,
    genesisId: suggested_params.genesisId,
  };

  const group_tx1 = new Transaction(txnFields1);
  console.log("group_tx1:", group_tx1);

  const pay2: PaymentTransactionFields = {
    amount: 0n,
    receiver: Address.fromString(rocca_address),
  }

  const txnFields2: TransactionParams = {
    type: TransactionType.Payment,
    payment: pay2,
    sender: Address.fromString(rocca_address),
    fee: 0n,
    firstValid: suggested_params.firstValid,
    lastValid: suggested_params.lastValid,
    genesisHash: suggested_params.genesisHash,
    genesisId: suggested_params.genesisId,
  };

  const group_tx2 = new Transaction(txnFields2);

  return groupTransactions([group_tx1, group_tx2])

}

export const broadcastSignedGroupTxn = async (signedTxns: SignedTransaction[]): Promise<PostTransactionsResponse> => {

  const algorand = await AlgorandClient.testNet();

  const encodedSignedTxns: Uint8Array[] = []

  signedTxns.forEach((stxn) => {
    encodedSignedTxns.push(encodeSignedTransaction(stxn));
  });

  return algorand.client.algod.sendRawTransaction(encodedSignedTxns);

}



export const handleARC27Txn = async (
  message: string,
  signTxn: (bytesToSign: Uint8Array) => Promise<string | null>
): Promise<string | null> => {
  try {
    const cborBytes = fromBase64Url(message)
    const decoded = cborDecode(cborBytes)

    if (!decoded || typeof decoded !== 'object') return null
    const obj = decoded as any
    if (obj.reference !== 'arc0027:sign_transactions:request') return null

    const params = obj.params
    const txns = Array.isArray(params?.txns) ? params.txns : []
    const requestId = obj.id

    const signedTxns: string[] = []

    for (const txnObj of txns) {
      const txnB64u = txnObj?.txn
      if (!txnB64u || typeof txnB64u !== 'string') continue
      const txnBytes = fromBase64Url(txnB64u)

      // Algorand 'TX' prefix
      const prefix = new Uint8Array([0x54, 0x58])
      const bytesToSign = new Uint8Array(prefix.length + txnBytes.length)
      bytesToSign.set(prefix, 0)
      bytesToSign.set(txnBytes, prefix.length)

      const sig = await signTxn(bytesToSign)
      if (sig) signedTxns.push(sig)
    }

    const response: any = {
      id: uuidv4(),
      reference: 'arc0027:sign_transactions:response',
      requestId,
      result: {
        providerId: params?.providerId ?? 'liquid-auth-js',
        stxns: signedTxns,
      },
    }

    const encoded = cborEncode(response)
    return toBase64URL(encoded as Uint8Array)
  } catch (e) {
    console.error('Error handling ARC-27 txn:', e)
    return null
  }
}
