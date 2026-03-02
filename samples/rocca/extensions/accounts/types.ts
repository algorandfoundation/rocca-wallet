import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";
import type { HookCollection } from "before-after-hook";

/**
 * Options for the AccountStore extension.
 */
export interface AccountStoreOptions extends ExtensionOptions {
	accounts: {
		store: Store<AccountStoreState>;
		hooks: HookCollection<any>;
	};
}

export type AccountType = "ed25519" | "lsig" | "falcon" | string;

export interface AccountAsset {
	id: string;
	name: string;
	type: string;
	balance: bigint;
	metadata: Record<string, any>;
	transfer?(amount: bigint, account: Account): void;
}

/**
 * Represents an account that can sign transactions.
 */
export interface Account {
	/**
	 * The public address of the account.
	 */
	address: string;

	/**
	 *
	 */
	balance: bigint;

	/**
	 *
	 */
	assets: AccountAsset[];

	/**
	 * Type of account
	 */
	type: AccountType;
	/**
	 * A method to sign a transaction or a set of transactions.
	 *
	 * @param txns - The transactions to sign.
	 * @returns The signed transactions.
	 */
	sign?: (txns: Uint8Array[]) => Promise<Uint8Array[]>;

	/**
	 * Subclass via the metadata
	 */
	metadata?: Record<string, any>;

	transfer?(amount: bigint, account: Account): void;
}

/**
 * The state of the account store.
 */
export interface AccountStoreState {
	/**
	 * The list of accounts in the store.
	 */
	accounts: Account[];
}

/**
 * Represents an account store interface for managing accounts.
 */
export interface AccountStoreExtension extends AccountStoreState {
	/**
	 * An object that represents additional functionality provided by this extension.
	 */
	account: {
		store: AccountStoreApi;
	};
}

/**
 * Interface representing an AccountStore extension API.
 */
export interface AccountStoreApi {
	/**
	 * Adds an account to the store.
	 *
	 * @param account - The account to add.
	 * @returns The added account.
	 */
	addAccount: (account: Account) => Promise<Account>;
	/**
	 * Removes an account from the store by its address.
	 *
	 * @param address - The address of the account to remove.
	 * @returns A promise that resolves when the account is removed.
	 */
	removeAccount: (address: string) => Promise<void>;
	/**
	 * Retrieves an account from the store by its address.
	 *
	 * @param address - The address of the account to retrieve.
	 * @returns The account if found, otherwise undefined.
	 */
	getAccount: (address: string) => Promise<Account | undefined>;
	/**
	 * Clears all accounts from the store.
	 *
	 * @returns A promise that resolves when the store is cleared.
	 */
	clear: () => Promise<void>;
	/**
	 * The hooks for account store operations.
	 */
	hooks: HookCollection<any>;
}
