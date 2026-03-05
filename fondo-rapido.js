// fondo-rapido.js - Versión simple
(function() {
    try {
        if (document.body) {
            aplicarFondoRapido();
        } else {
            const observer = new MutationObserver(function() {
                if (document.body) {
                    aplicarFondoRapido();
                    observer.disconnect();
                }
            });
            observer.observe(document.documentElement, { childList: true });
        }
    } catch(e) {}
    
    function aplicarFondoRapido() {
        try {
            if (document.getElementById('fondo-activo')) return;
            
            const saved = localStorage.getItem('starTab_fondo_rapido');
            if (!saved) return;
            
            const cfg = JSON.parse(saved);
            if (!cfg.tipo) return;
            
            const el = document.createElement('div');
            el.id = 'fondo-activo';
            
            let css = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1;pointer-events:none;';
            
            // BLUR - línea simple y directa
            if (cfg.desenfoque > 0) {
                css += `filter:blur(${cfg.desenfoque}px);-webkit-filter:blur(${cfg.desenfoque}px);`;
            }
            
            if (cfg.tipo === 'imagen' && cfg.url) {
                const op = cfg.opacidad || 0.2;
                css += `background:linear-gradient(rgba(0,0,0,${op}),rgba(0,0,0,${op})),url('${cfg.url}');`;
                css += 'background-size:cover;background-position:center;';
            } 
            else if (cfg.tipo === 'gradiente' && cfg.colorInicio && cfg.colorFin) {
                css += `background:linear-gradient(135deg,${cfg.colorInicio},${cfg.colorFin});`;
            }
            
            el.style.cssText = css;
            document.body.insertBefore(el, document.body.firstChild);
        } catch(e) {}
    }
})();