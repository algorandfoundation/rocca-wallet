import type { AccountStoreState } from "@algorandfoundation/accounts-store";
import {Store} from "@tanstack/react-store";

export const accountsStore = new Store<AccountStoreState>({
    accounts: [],
})