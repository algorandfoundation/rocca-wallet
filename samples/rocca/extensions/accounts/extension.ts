import type { Extension } from "@algorandfoundation/wallet-provider";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";
import {
	addAccount,
	clearAccounts,
	getAccount,
	removeAccount,
} from "./store";
import type {
	Account,
	AccountStoreExtension,
	AccountStoreState,
} from "./types";

/**
 * Extension that adds account management capabilities to a Provider.
 *
 * @param provider - The provider instance being extended.
 * @param options - Configuration options for the extension.
 * @returns The account store extension.
 */
export const WithAccountStore: Extension<AccountStoreExtension> = (
	provider,
	options,
) => {
	const store = options?.accounts?.store ?? new Store<AccountStoreState>({accounts: []});
	const hooks = options?.accounts?.hooks ?? new Hook.Collection<any>();

	return {
		get accounts() {
			return store.state.accounts;
		},
		account: {
			store: provider.account?.store || {
				async addAccount(account: Account) {
					return hooks("add", addAccount, { store, account });
				},
				async removeAccount(address: string) {
					return hooks("remove", removeAccount, { store, address });
				},
				async getAccount(address: string) {
					return hooks("get", getAccount, { store, address });
				},
				async clear() {
					return hooks("clear", clearAccounts, { store });
				},
				hooks,
			},
		},
	} as AccountStoreExtension;
};
