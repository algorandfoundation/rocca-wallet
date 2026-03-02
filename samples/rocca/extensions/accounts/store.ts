import type { Store } from "@tanstack/store";
import type { Account, AccountStoreState } from "./types.ts";

/**
 * Adds an account to the store.
 *
 * @param params - The add parameters.
 * @param params.store - The TanStack store instance for {@link AccountStoreState}.
 * @param params.account - The {@link Account} to add.
 * @returns The added {@link Account}.
 */
export function addAccount({
	store,
	account,
}: {
	store: Store<AccountStoreState>;
	account: Account;
}): Account {
	store.setState((state) => {
		return {
			...state,
			accounts: [account, ...state.accounts],
		};
	});
	return account;
}

/**
 * Removes an account from the store by its address.
 *
 * @param params - The removal parameters.
 * @param params.store - The TanStack store instance for {@link AccountStoreState}.
 * @param params.address - The address of the account to remove.
 */
export function removeAccount({
	store,
	address,
}: {
	store: Store<AccountStoreState>;
	address: string;
}): void {
	store.setState((state) => {
		return {
			...state,
			accounts: state.accounts.filter((account) => account.address !== address),
		};
	});
}

/**
 * Retrieves an account from the store by its address.
 *
 * @param params - The retrieval parameters.
 * @param params.store - The TanStack store instance for {@link AccountStoreState}.
 * @param params.address - The address of the account to retrieve.
 * @returns The {@link Account} if found, otherwise undefined.
 */
export function getAccount({
	store,
	address,
}: {
	store: Store<AccountStoreState>;
	address: string;
}): Account | undefined {
	return store.state.accounts.find((account) => account.address === address);
}

/**
 * Clears all accounts from the store.
 *
 * @param params - The store parameters.
 * @param params.store - The TanStack store instance for {@link AccountStoreState}.
 */
export function clearAccounts({
	store,
}: {
	store: Store<AccountStoreState>;
}): void {
	store.setState((state) => {
		return {
			...state,
			accounts: [],
		};
	});
}
