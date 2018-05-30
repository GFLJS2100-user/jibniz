(function(factory) {
  if (typeof module != 'undefined' && typeof module.exports != 'undefined') {
    module.exports = factory()
  }
  else {
    window.jibniz = factory()
  }
}(function() {

  'use strict'

  let J = {}

  // VVUU.YYYY
  let YUVtoHEX = c => {
    let y = c >> 8 & 0xff
    return 0xff000000 | y << 16 | y << 8 | y
  }

  J.VM = function(cvs) {
    // UGLY MESS

    // memory is accessible via 20-bit wide address
    let MEM     = this.MEM     = new Int32Array(1 << 20)
    let USRDATA = this.USRDATA = new Int32Array(MEM.buffer,      0, 0xC0000)
    let ARSTACK = this.ARSTACK = new Int32Array(MEM.buffer, 102400,   16384)
    let VRSTACK = this.VRSTACK = new Int32Array(MEM.buffer, 104448,   16384)
    let ASTACK  = this.ASTACK  = new Int32Array(MEM.buffer, 106496,   65536)
    let VSTACK  = this.VSTACK  = new Int32Array(MEM.buffer, 114688,  131072)

    let audio = this.audio = { S: ASTACK, sn: 0, sm:  65535, R: ARSTACK, rn: 0, rm: 16383 }
    let video = this.video = { S: VSTACK, sn: 0, sm: 131071, R: VRSTACK, rn: 0, rm: 16383 }

    this.time = 0
    this.tyx = true

    // position of the current fragment
    let x = 0
    let y = 0

    let mouseX  = 0
    let mouseY  = 0
    let ctrlKey = 0
    let altKey  = 0
    let click   = 0

    this.runOnce = function(program) {
      program(video, MEM, null, 0)
    }

    this.step = function(program) {
      let w = this.tyx ? whereami_tyx : whereami_t

      for (y = 0; y < 256; y++) {
        for(x = 0; x < 256; x++) {
          w(video.sn)
          program(video, MEM, w, 0)
        }
      }

      let offset = video.sn < 65536 ? 65536 : 0

      this.time++
    }.bind(this)

    // tmp: to be deleted
    this.push = function(x) {
      VSTACK[video.sn] = x
      video.sn = video.sn + 1 & video.sm
    }

    this.pop = function() {
      video.sn = video.sn + video.sm & video.sm
      return VSTACK[video.sn]
    }

    let coord = v => v - 128 << 9

    let whereami_tyx = (sn) => {
      video.sn = sn
      push(this.time << 16)
      push(coord(y))
      push(coord(x))
      return video.sn
    }

    let whereami_t = (sn) => {
      video.sn = sn
      push(this.time << 16 | y << 8 | x)
      return video.sn
    }

  }

  J.VM.prototype.reset = function() {
    this.MEM.fill(0)
    this.time = 0
    this.program = null
  }

  // increase/decrease stack pointer
  let sincr = 'sn=sn+1&sm;'
  let sdecr = 'sn=sn+sm&sm;'

  // increase/decrease ret pointer
  let rincr = 'rn=rn+1&rm;'
  let rdecr = 'rn=rn+rm&rm;'

  let codes = {

    // ARITHMETIC
    '+': sdecr
       + 'a=sn+sm&sm;'
       + 'S[a]=S[a]+S[sn];',

    '-': sdecr
       + 'a=sn+sm&sm;'
       + 'S[a]=S[a]-S[sn];',

    '*': sdecr
       + 'a=sn+sm&sm;'
       + 'S[a]=(S[a]/65536)*(S[sn]/65536)*65536|0;',

    '/': sdecr
       + 'a=sn+sm&sm;'
       + 'S[a]=S[sn]==0?0:(S[a]*65536)/S[sn];',

    '%': sdecr
       + 'a=sn+sm&sm;'
       + 'S[a]=S[sn]==0?0:S[a]%S[sn];',

    // square root
    'q': 'a=sn+sm&sm;'
       + 'S[a]=S[a]>0?Math.sqrt(S[a]/65536)*65536|0:0;',

    '&': sdecr
       + 'a=sn+sm&sm;'
       + 'S[a]=S[a]&S[sn];',

    '|': sdecr
       + 'a=sn+sm&sm;'
       + 'S[a]=S[a]|S[sn];',

    '^': sdecr
       + 'a=sn+sm&sm;'
       + 'S[a]=S[a]^S[sn];',

    // rotate shift
    'r': sdecr
       + 'a=sn+sm&sm;'
       + 'b=S[sn]>>>16;'
       + 'c=S[a];'
       + 'S[a]=(c>>>b)|(c<<(32-b));',

    'l': sdecr
       + 'a=sn+sm&sm;'
       + 'S[a]=S[a]<<(S[sn]>>>16);',

    '~': 'a=sn+sm&sm;'
       + 'S[a]=~S[a];',

    // sin
    's': 'a=sn+sm&sm;'
       + 'S[a]=Math.sin(S[a]*Math.PI/32768)*65536;',

    // atan
    'a': sdecr
       + 'a=sn+sm&sm;'
       + 'S[a]=Math.atan2(S[a]/65536,S[sn]/65536)/Math.PI*32768;',

    '<': 'a=sn+sm&sm;'
       + 'if(S[a]>0)S[a]=0;',

    '>': 'a=sn+sm&sm;'
       + 'if(S[a]<0)S[a]=0;',

    '=': 'a=sn+sm&sm;'
       + 'S[a]=(S[a]==0)<<16;',


    // STACK MANIPULATION

    // dup: a -- a a
    'd': 'S[sn]=S[sn+sm&sm];'
       + sincr,

    // pop: a --
    'p': sdecr,

    // exchange: a b -- b a
    'x': 'a=sn+sm&sm;'
       + 'b=a+sm&sm;'
       + 'c=S[a];S[a]=S[b];S[b]=c;',

    // trirot: a b c -- b c a
    'v': 'a=sn+sm&sm;'
       + 'b=a+sm&sm;'
       + 'c=b+sm&sm;'
       + 'd=S[a];S[a]=S[c];S[c]=S[b];S[b]=d;',

    // pick: i -- val
    // TODO: wrap within stack range
    ')': 'a=sn+sm&sm;'
       + 'S[a]=S[a+sm-(S[a]>>>16)&sm];',

    // bury: val i --
    '(': sdecr
       + 'a=S[sn]>>16;'
       + sdecr
       + 'S[sn+sm-a&sm]=S[sn];',

    // EXTERIOR LOOP

    // M: mediaswitch

    // whereami
    'w': 'sn=w(sn);',

    // terminate
    'T': 'break;',


    // MEMORY MANIPULATION

    // load: addr -- val
    '@': 'a=sn+sm&sm;'
       + 'b=S[a];'
       + 'S[a]=M[(b>>>16)|((b&0xf)<<16)];',

    // store: val addr --
    '!': 'b=S[sn=sn+sm&sm];'
       + 'a=S[sn=sn+sm&sm];'
       + 'M[(b>>>16)|((b&0xf)<<16)]=a;',

    // PROGRAM CONTROL

    // Conditional Execution

    // if, else, endif
    // TODO: take care of this at parsing
    //       i.e. finding end of scopes

    // Loops
    // loop
    'L': 'a=--R[rn+(rm<<1)&rm];'
       + 'if(a!=0){i=R[rn+rm&rm];continue}'
       + 'else ' + rdecr,

    // index: -- i
    'i': 'S[sn]=R[rn+(rm<<1)&rm];' + sincr,

    // outdex: -- j
    'j': 'S[sn]=R[rn+(rm<<2)&rm];' + sincr,

    // while: cond --
    ']': sdecr
       + 'if(S[sn]!=0){i=R[rn+rm&rm];continue}'
       + 'else ' + rdecr,

    // jump: v --
    'J': sdecr
       + 'i=S[sn];continue;',

    // Subroutines
    // return
    '}': rdecr
       + 'i=R[rn];continue;',

    // Return stack manipulation
    // retaddr: -- val | val --
    'R': rdecr
       + 'S[sn]=R[rb];'
       + sincr,

    // pushtors: val -- | -- val
    'P': sdecr
       + 'R[rn]=S[sn];'
       + rincr,

    // INPUT

    // userin: -- inword
    'U': 'S[sn]=U;' + sincr,
  }

  function eatUntil(state, check) {
    while(state.pos < state.len && !check(state.src[state.pos]))
      next(state)
  }

  let isHexaDecimal = c => {
    return !isNaN(c) || c == 'A' || c == 'B' || c == 'C'
                     || c == 'D' || c == 'E' || c == 'F'
  }

  let isBlank = c => c == ' ' || c == ',' || c == ';' || c == '\n'

  function next(state) {
    let c = state.src[state.pos++]

    if (isBlank(c))
      return

    // comments
    if (c == '\\') {
      while (state.pos < state.len && state.src[state.pos++] != '\n') {}
      return
    }

    state.body += '\ncase ' + (state.inst++) + ':'

    if (codes[c]) {
      state.body += codes[c]
    }

    else if (isHexaDecimal(c) || c == '.') {
      let imm = 0

      if (c != '.') {
        imm = parseInt(c, 16)

        while (state.pos < state.len && isHexaDecimal(state.src[state.pos]))
          imm = imm << 4 | parseInt(state.src[state.pos++], 16)

        imm <<= 16
        c = state.src[state.pos]
        if (c == '.') state.pos++
      }

      if (c == '.') {
        let i = 0, frac = 0

        for (; i < 4 && isHexaDecimal(state.src[state.pos]); i++)
          frac = frac << 4 | parseInt(state.src[state.pos++], 16) 

        // we ignore the following decimals
        while (state.pos < state.len && isHexaDecimal(state.src[state.pos]))
          state.pos++

        imm |= (frac << (4 - i))
      }

      state.body += 'S[sn]=' + imm + ';' + sincr;
    }

    else {
      if (c == '?') {
        let subs = {
          src:  state.src,
          pos:  state.pos,
          inst: state.inst,
          len:  state.len,
          body: '',
        }

        while (subs.pos < subs.len &&
               subs.src[subs.pos] != ':' &&
               subs.src[subs.pos] != ';') {
          next(subs)
        }

        // EOF is the end of scope
        if (subs.pos >= subs.len) {
          state.body += sdecr
                     + 'if(S[sn]==0)break;'
        }

        else {
          state.body += sdecr
                     + 'if(S[sn]==0){i=' + subs.inst + ';continue};'

          // else
          if (subs.src[subs.pos] == ':') {
            subs.pos++
            while (subs.pos < subs.len &&
                   subs.src[subs.pos] != ';' ) {
              next(subs)
            }
          }
        }

        state.body += subs.body
        state.inst = subs.inst
        state.pos  = subs.pos
      }

      else if (c == '{') {
        let subs = {
          src:  state.src,
          pos:  state.pos,
          inst: state.inst,
          len:  state.len,
          body: '',
        }

        while (subs.pos < subs.len && subs.src[subs.pos] != '}') {
          next(subs)
        }

        if (subs.pos < subs.len)
          next(subs)

        state.body += sdecr
                    + 'M[S[sn]>>16]=' + state.inst + ';'
                    + 'i=' + subs.inst + ';continue;'

        state.pos = subs.pos + 1
        state.body += subs.body
        state.inst = subs.inst
      }

      else if (c == 'V') {
        state.body += sdecr
                    + 'i=M[S[sn]>>16];'
                    + 'R[rn]=' + state.inst + ';'
                    + rincr
                    + 'continue;'
      }

      else if (c == 'X') {
        state.body += sdecr
                    + 'R[rn]=S[sn];'
                    + rincr
                    + 'R[rn]=' + state.inst + ';'
                    + rincr
      }

      else if (c == '[') {
        state.body += 'R[rn]=' + state.inst + ';'
                    + rincr
      }
    }
  }

  J.compile = function(src) {
    let state = {
      src,
      pos:  0,
      inst: 0,
      len:  src.length,
      body: '',
    }

    state.body += 'let l=true,i=0,{S,R,sm,rm,sn,rn}=o,a,b,c,d;'
    state.body += 'while(l){switch(i){'

    while (state.pos < state.len)
      next(state)

    state.body += '\n}l=false}o.sn=sn;o.rn=rn'

    return new Function('o', 'M', 'w', 'U', state.body)
  }

  return J

}))
