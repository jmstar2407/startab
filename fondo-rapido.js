// fondo-rapido.js
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

            let css = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1;pointer-events:none;overflow:hidden;';

            if (cfg.desenfoque > 0) {
                css += `filter:blur(${cfg.desenfoque}px);-webkit-filter:blur(${cfg.desenfoque}px);`;
            }

            if (cfg.tipo === 'imagen' && cfg.url) {
                const op = cfg.opacidad || 0.2;
                css += `background:linear-gradient(rgba(0,0,0,${op}),rgba(0,0,0,${op})),url('${cfg.url}');`;
                css += 'background-size:cover;background-position:center;';
                el.style.cssText = css;
            }
            else if (cfg.tipo === 'gradiente' && cfg.colorInicio && cfg.colorFin) {
                css += `background:linear-gradient(135deg,${cfg.colorInicio},${cfg.colorFin});`;
                el.style.cssText = css;
            }
            else if (cfg.tipo === 'video' && cfg.url) {
                css += 'background:#000;';
                el.style.cssText = css;

                const video = document.createElement('video');
                video.src = cfg.url;
                video.autoplay = true;
                video.loop = true;
                video.muted = true;
                video.playsInline = true;
                video.setAttribute('playsinline', '');
                video.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;';
                video.addEventListener('canplay', function() {
                    video.play().catch(function() {});
                }, { once: true });
                el.appendChild(video);
            }
            else {
                // tipo desconocido o sin url — no insertar nada, evita flash negro
                return;
            }

            document.body.insertBefore(el, document.body.firstChild);

            // ✅ Decirle a script.js cuál es el fondo que ya está en pantalla,
            // para que NO lo destruya ni reinicie cuando Firebase responda.
            window._fondoActivoConfig = {
                tipo: cfg.tipo,
                url: cfg.url || null,
                opacidad: cfg.opacidad,
                desenfoque: cfg.desenfoque,
                colorInicio: cfg.colorInicio || null,
                colorFin: cfg.colorFin || null
            };

        } catch(e) {}
    }
})();