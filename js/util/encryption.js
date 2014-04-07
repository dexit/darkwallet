define(['bitcoinjs-lib', 'util/multiParty', 'util/stealth', 'sjcl'],
function (Bitcoin, multiParty, Stealth) {
  'use strict';
  var CryptoJS = Bitcoin.Crypto;
  var convert = Bitcoin.convert;

  /*************************************
   * Test encrypt / decrypt using similar derivation as stealth
   */

  /*
   * Encrypt the given message
   * @param {Object} pubKey Public key as byte array
   * @param {String} Message to encrypt
   */
  var stealthEncrypt = function(pubKey, message) {
    var encKey = new Bitcoin.Key();
    var ephemKey = encKey.getPubPoint().getEncoded(true);

    var decKey = Stealth.importPublic(pubKey);
    var c = Stealth.stealthDH(encKey.priv, decKey);
    var _pass = Bitcoin.convert.bytesToString(c);
    var encrypted = sjcl.encrypt(_pass, message, {ks: 256, ts: 128});
    return {pub: ephemKey, data: sjcl.json.decode(encrypted)}
  }

  /*
   * Decrypt the given message
   * @param {Bitcoin.Key} pubKey Private key
   * @param {String} message Message to decrypt, should have pub and data components
   */
  var stealthDecrypt = function(privKey, message) {
    var masterSecret = privKey.export('bytes')
    var priv = Bitcoin.BigInteger.fromByteArrayUnsigned(masterSecret.slice(0, 32));

    var decKey = Stealth.importPublic(message.pub);
    var c = Stealth.stealthDH(priv, decKey)
    var _pass = Bitcoin.convert.bytesToString(c);
    var decrypted = sjcl.decrypt(_pass, sjcl.json.encode(message.data));

    return decrypted;
  }

  /*
   * Decrypt the given message for some identity bip32 key
   * @param {String} message Message to decrypt
   * @param {DarkWallet.Identity} identity Identity to use
   * @param {Array} seq Key seq to use for decryption
   * @param {String} password Password for the user private keys
   * @param {Object} callback Callback receiving the decrypted data
   */

  var stealthDecryptForIdentity = function(message, identity, seq, password, callback) {
    identity.wallet.getPrivateKey(seq, password, function(privKey) {
        callback(stealthDecrypt(privKey, message));
    });
  }



  /*
   * pbkdf2 wrapper
   */
  var pbkdf2 = function(password, salt, iterations) {
      // pbkdf2 using crypto-js, it's equivalent, but much slower, so using sjcl for now
      //   var kdf = CryptoJS.algo.PBKDF2.create({ keySize: 256/32, iterations: iterations, hasher: CryptoJS.algo.SHA256 });
      //   return kdf.compute(password, salt);

      // faster sjcl implementation
      return sjcl.misc.pbkdf2(password, salt.words, iterations);
  }
  /*
   * Generate message tag. 8 rounds of SHA512
   * Input: WordArray
   * Output: Base64
   */
  var messageTag = function(message) {
    for (var i = 0; i !== 8; i++) {
      message = CryptoJS.SHA512(message)
    }
    return message.toString(CryptoJS.enc.Base64)
  }

  /*
   * Generate a shared secret
   */
  var genSharedSecret = function(priv, pub) {
    //I need to convert the BigInt to WordArray here. I do it using the Base64 representation.
    var sharedSecret = CryptoJS.SHA512(
      convert.bytesToWordArray(
        Curve25519.ecDH(priv,pub).toByteArrayUnsigned()
      )
    )

    return {
    'message': CryptoJS.lib.WordArray.create(sharedSecret.words.slice(0, 8)),
    'hmac': CryptoJS.lib.WordArray.create(sharedSecret.words.slice(8, 16))
    }
  }

  /*
   * Encrypt with password derivation
   */
  var encrypt = function(password, msg) {
    // do pbkdf2 on the password
    var salt = CryptoJS.lib.WordArray.random(128/8);
    var encKey = pbkdf2(password, salt, 1000);

    // prepare for aes
    var iv = CryptoJS.enc.Base64.stringify(CryptoJS.lib.WordArray.random(12));
    var message = CryptoJS.enc.Utf8.parse(msg);
    // Add 64 bytes of padding
    message.concat(CryptoJS.lib.WordArray.random(64));

    // encrypt
    var cypher = multiParty.encryptAES(message, encKey, iv);

    // tag
    var hmac = CryptoJS.lib.WordArray.create();
    hmac.concat(iv);
    hmac.concat(cypher);
    var tag = CryptoJS.HmacSHA512(hmac, tagKey);
    return {data: cypher, iv: iv, salt: salt.toString(), it: 1000, ks: 256, pad: 64};
  }

  /*
   * Decrypt with password derivation
   */
  var decrypt = function(password, cypher) {
    // do pbkdf2 on the password
    var salt = CryptoJS.enc.Hex.parse(cypher.salt);
    var encKey = pbkdf2(password, salt, cypher.it);

    // decrypt
    var plaintext = multiParty.decryptAES(cypher.data, encKey, cypher.iv);

    // format return
    plaintext = CryptoJS.lib.WordArray.create(plaintext.words, plaintext.sigBytes-cypher.pad);
    return plaintext.toString(CryptoJS.enc.Utf8);
  }

  /*
   * Test
   */
  var test = function() {
    var cypher = encrypt('bla', 'foobar!');
    var plaintext = decrypt('bla', cypher);
    return plaintext;
  }

  return {
    pbkdf2: pbkdf2,
    encrypt: encrypt,
    decrypt: decrypt,
    stealth: {
      encrypt: stealthEncrypt,
      decrypt: stealthDecrypt,
      decryptForIdentity: stealthDecryptForIdentity
    },
    test: test
  }

});
