/*globals sendMsg*/


// eslint-disable-next-line no-unused-vars
class Gui{
    constructor(){
        this.settings = {};
    }

    onerr(e){
        let msg = {
            message: (e && e.message) ? e.message : String(e)
        };
        if(this.settings && this.settings.url){
            msg.url = this.settings.url;
        }
        alert(JSON.stringify(msg, null, 2));
        console.log(e);
        this.mystop();
    }

    progress(prefix, cur, max){
        let per = Math.round(cur / max * 100);
        if(per > 100){per = 100;}
        this.addName(`${prefix} ${per}%`);
        this.addPercent(per);
    }

    myspin(){
        sendMsg('myspin');
    }
    mystop(){
        sendMsg('mystop');
    }
    addName(name){
        sendMsg('addName', [name]);
    }
    addPercent(per){
        sendMsg('addPercent', [per]);
    }
    buttonEnable(){
        sendMsg('buttonEnable');
    }

    reload(al){
        location.href = al.url;
    }
}

