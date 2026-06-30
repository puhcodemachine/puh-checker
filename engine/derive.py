# Серверная деривация адресов по всем путям (зеркало клиентского paths.js) через bip_utils.
from bip_utils import (Bip39SeedGenerator, Bip44, Bip49, Bip84, Bip86,
                       Bip44Coins, Bip49Coins, Bip84Coins, Bip86Coins, Bip44Changes,
                       Bip32Slip10Ed25519, SolAddrEncoder,
                       CardanoIcarusSeedGenerator, Cip1852, Cip1852Coins, CardanoShelley,
                       Monero)

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
    for i in range(3): acc(Bip44, Bip44Coins.TRON, "TRC20/TRX", "TRX", "tron", f"m/44'/195'/0'/0/{i}", 0, i)
    # Solana (Ed25519 SLIP-10) — Phantom/Solflare/Trust (m/44'/501'/i'/0') + Ledger (m/44'/501'/i')
    sol = Bip32Slip10Ed25519.FromSeed(seed)
    def soladd(std, path):
        out.append({"coin": "SOL", "std": std, "chain": "solana", "path": path,
                    "addr": SolAddrEncoder.EncodeKey(sol.DerivePath(path).PublicKey().KeyObject())})
    for i in range(3): soladd("Phantom/Solflare", f"m/44'/501'/{i}'/0'")
    for i in range(2): soladd("Ledger", f"m/44'/501'/{i}'")
    # Cardano Shelley (CIP-1852) — payment+stake адрес addr1...
    try:
        cseed = CardanoIcarusSeedGenerator(mnemonic).Generate()
        sh = CardanoShelley.FromCip1852Object(Cip1852.FromSeed(cseed, Cip1852Coins.CARDANO_ICARUS).Purpose().Coin().Account(0))
        for i in range(2):
            a = sh.Change(Bip44Changes.CHAIN_EXT).AddressIndex(i)
            out.append({"coin": "ADA", "std": "Shelley CIP-1852", "chain": "cardano",
                        "path": f"m/1852'/1815'/0'/0/{i}", "addr": a.PublicKeys().ToAddress()})
    except Exception:
        pass
    # Monero (BIP39→XMR через SLIP-10) — адрес + приватный view-key (для проверки баланса light-сервером)
    try:
        mpriv = Bip44.FromSeed(seed, Bip44Coins.MONERO_ED25519_SLIP).DeriveDefaultPath().PrivateKey().Raw().ToBytes()
        mon = Monero.FromBip44PrivateKey(mpriv)
        out.append({"coin": "XMR", "std": "BIP39→Monero", "chain": "monero", "path": "m/44'/128'/0'/0/0",
                    "addr": mon.PrimaryAddress(), "view_key": mon.PrivateViewKey().Raw().ToHex()})
    except Exception:
        pass
    return out

if __name__ == "__main__":
    import json, sys
    print(json.dumps(derive_all(sys.argv[1] if len(sys.argv) > 1 else
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about")))
