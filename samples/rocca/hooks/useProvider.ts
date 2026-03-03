import {useContext} from "react";
import {useStore} from "@tanstack/react-store";

import {WalletProviderContext} from "@/providers/ReactNativeProvider";
import {keyStore} from "@/stores/keystore";
import { accountsStore } from '@/stores/accounts'

export function useProvider(){
    const provider = useContext(WalletProviderContext)
    if(provider === null) throw new Error('No Provider Found')

    // Hydrate the store in the context (React)
    const keys = useStore(keyStore, (state)=>state.keys);
    const status = useStore(keyStore, (state)=>state.status)
    const accounts = useStore(accountsStore, (state)=>state.accounts)

    return {...provider, keys, status, accounts};
}
