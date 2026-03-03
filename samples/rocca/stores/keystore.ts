import { Store } from "@tanstack/react-store";
import {KeyStoreState} from "@algorandfoundation/keystore";
import {localStorage} from "@/stores/mmkv-local";

export const keyStore = new Store<KeyStoreState>({
    keys: [],
    status: 'idle'
})

keyStore.subscribe(state => {
    const status = localStorage.getString('status')
    if(state.status !== status){
        localStorage.set('status', state.status)
    }
})