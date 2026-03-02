import type {
	AccountStoreExtension,
	AccountStoreOptions,
	AccountStoreState,
} from "@algorandfoundation/accounts-store";
import type {
	KeyStoreExtension,
	KeyStoreOptions,
} from "@algorandfoundation/keystore";
import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";
import type { HookCollection } from "before-after-hook";

/**
 * Options for the AccountsKeystore extension.
 */
export interface AccountsKeystoreExtensionOptions
	extends ExtensionOptions,
		AccountStoreOptions,
		KeyStoreOptions {
	accounts: {
		store: Store<AccountStoreState>;
		hooks: HookCollection<any>;
		keystore: {
			/**
			 * Whether to automatically add accounts for all compatible keys in the keystore.
			 * Defaults to true.
			 */
			autoPopulate?: boolean;
		};
	};
}

/**
 * The interface exposed by the Accounts Keystore Extension.
 *
 * This extension bridges the Accounts Store and the Keystore,
 * providing accounts that are backed by the keystore for signing.
 */
export interface AccountsKeystoreExtension extends AccountStoreExtension, KeyStoreExtension {
  account: AccountStoreExtension["account"] & {
    keystore: {
      autoPopulate: boolean;
    }
  }
}
