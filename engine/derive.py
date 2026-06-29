# Серверная деривация адресов по всем путям (зеркало клиентского paths.js) через bip_utils.
from bip_utils import (Bip39SeedGenerator, Bip44, Bip49, Bip84, Bip86,
                       Bip44Coins, Bip49Coins, Bip84Coins, Bip86Coins, Bip44Changes)

def derive_all(mnemonic):
    seed = Bip39SeedGenerator(mnemonic).Generate()
    out = []
    def acc(cls, coin, std, coinname, chain, path, account, index):
        b = cls.FromSeed(seed, coin).Purpose().Coin().Account(account).Change(Bip44Changes.CHAIN_EXT).AddressIndex(index)
        out.append({"coin": coinname, "std": std, "chain": chain, "path": path, "addr": b.PublicKey().ToAddress()})
    for i in range(5): acc(Bip44, Bip44Coins.BITCOIN, "Legacy BIP44", "BTC", "bitcoin", f"m/44'/0'/0'/0/{i}", 0, i)
    for i in range(5): acc(Bip49, Bip49Coins.BITCOIN, "P2SH-SegWit BIP49", "BTC", "bitcoin", f"m/49'/0'/0'/0/{i}", 0, i)
    for i in range(5): acc(Bip84, Bip84Coins.BITCOIN, "SegWit BIP84", "BTC", "bitcoin", f"m/84'/0'/0'/0/{i}", 0, i)
    for i in range(5): acc(Bip86, Bip86Coins.BITCOIN, "Taproot BIP86", "BTC", "bitcoin", f"m/86'/0'/0'/0/{i}", 0, i)
    for i in range(3): acc(Bip44, Bip44Coins.LITECOIN, "Legacy BIP44", "LTC", "litecoin", f"m/44'/2'/0'/0/{i}", 0, i)
    for i in range(3): acc(Bip49, Bip49Coins.LITECOIN, "P2SH-SegWit BIP49", "LTC", "litecoin", f"m/49'/2'/0'/0/{i}", 0, i)
    for i in range(3): acc(Bip84, Bip84Coins.LITECOIN, "SegWit BIP84", "LTC", "litecoin", f"m/84'/2'/0'/0/{i}", 0, i)
    for i in range(3): acc(Bip44, Bip44Coins.DOGECOIN, "Legacy BIP44", "DOGE", "dogecoin", f"m/44'/3'/0'/0/{i}", 0, i)
    for i in range(3): acc(Bip44, Bip44Coins.DASH, "Legacy BIP44", "DASH", "dash", f"m/44'/5'/0'/0/{i}", 0, i)
    for i in range(5): acc(Bip44, Bip44Coins.ETHEREUM, "Standard (MetaMask)", "ETH", "evm", f"m/44'/60'/0'/0/{i}", 0, i)
    for i in range(5): acc(Bip44, Bip44Coins.ETHEREUM, "Ledger Live", "ETH", "evm", f"m/44'/60'/{i}'/0/0", i, 0)
    for i in range(3): acc(Bip44, Bip44Coins.ETHEREUM_CLASSIC, "BIP44", "ETC", "ethereum-classic", f"m/44'/61'/0'/0/{i}", 0, i)
    return out

if __name__ == "__main__":
    import json, sys
    print(json.dumps(derive_all(sys.argv[1] if len(sys.argv) > 1 else
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about")))
