import type {
	Account,
	AccountStoreExtension,
	AccountStoreState,
} from "@/extensions/accounts";
import type {
	Key,
	KeyStoreExtension,
	KeyStoreState,
	XHDDerivedKeyData,
} from "@algorandfoundation/keystore";
import type { Extension } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";
import type {
	AccountsKeystoreExtension,
	AccountsKeystoreExtensionOptions,
} from "./types.ts";

/**
 * Extension that bridges the account store and keystore.
 *
 * It automatically populates the account store with accounts derived from keys
 * in the keystore, providing a sign method that leverages the keystore backend.
 */
export const WithAccountsKeystore: Extension<AccountsKeystoreExtension> = (
	provider: KeyStoreExtension & AccountStoreExtension,
	options: AccountsKeystoreExtensionOptions,
) => {
	// Ensure dependencies are present
	if (!provider.account) {
		throw new Error(
			"AccountsKeystore extension requires WithAccountStore extension to be present on the provider.",
		);
	}
	if (!provider.key) {
		throw new Error(
			"AccountsKeystore extension requires WithKeyStore extension to be present on the provider.",
		);
	}

	const keyStore: Store<KeyStoreState> = options.keystore.store;
	const accountStore: Store<AccountStoreState> = options.accounts.store;
	const { autoPopulate = true } = options.accounts.keystore ?? {};

	/**
	 * Creates an account object for a given key ID and address.
	 */
	const createKeyAccount = (
		keyId: string,
		address: string,
		parentKeyId?: string,
	): Account => ({
		address,
		type: "ed25519",
		assets: [],
		metadata: { keyId, parentKeyId },
		balance: BigInt(0),

		// TODO: Transfer helper
		transfer(amount: bigint, account: Account) {
			console.log(
				`Transferring ${amount} from ${address} to ${account.address}`,
			);
		},
		// TODO: TransactionSigners
		sign: async (txns: Uint8Array[]) => {
			// Sign each transaction using the keystore
			const signedTxns: Uint8Array[] = [];
			for (const txn of txns) {
				const signed = await provider.key.store.sign(keyId, txn);
				signedTxns.push(signed);
			}
			return signedTxns;
		},
	});

	// Initial population if enabled
	if (autoPopulate) {
		console.log("Auto-populating accounts from keystore...");
		const keys = [...((provider.keys as Key[]) ?? [])];
		for (const key of keys) {
			console.log(`Adding account for key ${key.id}-${key.type}...`);
			if (key.type === "hd-derived-ed25519") {
				provider.account.store.addAccount(
					createKeyAccount(
						key.id,
						((key as XHDDerivedKeyData)?.metadata?.address
							?.algorand as string) ?? "TODO: Add addresses to types",
						(key as XHDDerivedKeyData)?.metadata?.parentKeyId,
					),
				);
			}
		}

		keyStore.subscribe((state) => {
			const newKeys = (state as unknown as KeyStoreState).keys;

			// Find the difference between keys and newKeys
			const addedKeys = newKeys.filter(
				(newKey) => !keys.some((existingKey) => existingKey.id === newKey.id),
			);

			if (addedKeys.length === 0) return;

			addedKeys.forEach((k) => {
				keys.push(k);
			});

			const accounts = [...accountStore.state.accounts] as unknown as Account[];

			// Process only the newly added keys
			addedKeys.forEach((k) => {
				if (k.type === "hd-derived-ed25519") {
					console.log(`Adding account for key ${k.id}-${k.type}...`);
					const address = (k as XHDDerivedKeyData)?.metadata?.address
						?.algorand as string;
					const parentKeyId = (k as XHDDerivedKeyData)?.metadata?.parentKeyId;
					if (address) {
						provider.account.store.addAccount(
							createKeyAccount(k.id, address, parentKeyId),
						);
					}
				}
			});
			if (keys.some((k) => k.type === "hd-derived-ed25519"))
				console.log(
					`Found ${keys.length} keys, ${keys.filter((k) => k.type === "hd-derived-ed25519").length} HD keys`,
				);
			if (accounts.some((a) => a.type === "ed25519"))
				console.log(
					`Found ${accounts.length} accounts, ${accounts.filter((a) => a.type === "ed25519").length} non-accounts`,
				);
		});

		provider.account.store.hooks.before("clear", async () => {
			const keys = provider.keys.filter((k) => k.type === "hd-derived-ed25519");
			for (const k of keys) {
				await provider.key.store.remove(k.id);
			}
		});
	}

	// This extension doesn't add new API methods, it just bridges existing ones.
	// But it must return an object that matches the combined interface.
	return provider as unknown as AccountsKeystoreExtension;
};
