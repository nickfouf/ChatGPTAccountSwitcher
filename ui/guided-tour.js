// Keep the spotlight attached to the real control through scrolling and resizing.
export function attachGuidedTour(selector) {
  const overlay = document.querySelector('.guided-tour');
  const target = document.querySelector(selector);
  if (!overlay || !target) return () => {};
  const coach = overlay.querySelector('.tour-coach');
  const cutout = overlay.querySelector('.spotlight-cutout');
  const outline = overlay.querySelector('.spotlight-outline');
  const pointer = overlay.querySelector('.spotlight-arrow');
  const svg = overlay.querySelector('.spotlight-svg');
  const background = [document.querySelector('header'), document.querySelector('main')];
  background.forEach(el => { if (el) el.inert = true; });
  let frame = 0;
  const clamp = (n, min, max) => Math.min(Math.max(n, min), Math.max(min, max));

  function position() {
    const rect = target.getBoundingClientRect();
    const width = window.innerWidth, height = window.innerHeight;
    const pad = 8, gap = 32, edge = 14;
    const box = { x:Math.max(4, rect.left-pad), y:Math.max(4, rect.top-pad),
      w:Math.min(width-8, rect.width+pad*2), h:rect.height+pad*2 };
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    for (const node of [cutout, outline]) {
      for (const [key,value] of Object.entries({x:box.x,y:box.y,width:box.w,height:box.h})) node.setAttribute(key,value);
    }
    coach.style.width = Math.min(380, width-edge*2)+'px';
    const size = coach.getBoundingClientRect();
    const cx = box.x+box.w/2, cy = box.y+box.h/2;
    let left = clamp(cx-size.width/2,edge,width-size.width-edge), top, side;
    if (box.y+box.h+gap+size.height <= height-edge) {
      top=box.y+box.h+gap; side='below';
    } else if (box.y-gap-size.height >= edge) {
      top=box.y-gap-size.height; side='above';
    } else if (box.x-gap-size.width >= edge) {
      left=box.x-gap-size.width; top=clamp(cy-size.height/2,edge,height-size.height-edge); side='left';
    } else if (box.x+box.w+gap+size.width <= width-edge) {
      left=box.x+box.w+gap; top=clamp(cy-size.height/2,edge,height-size.height-edge); side='right';
    } else {
      top=box.y>height/2?edge:height-size.height-edge;
      side=box.y>height/2?'above':'below';
    }
    coach.style.left=left+'px'; coach.style.top=top+'px';
    coach.dataset.side=side;
    const anchorX=clamp(cx,left+32,left+size.width-32);
    let start, end;
    if (side==='below') { start=[anchorX,top-2]; end=[cx,box.y+box.h+4]; }
    if (side==='above') { start=[anchorX,top+size.height+2]; end=[cx,box.y-4]; }
    if (side==='left') { start=[left+size.width+2,top+size.height/2]; end=[box.x-4,cy]; }
    if (side==='right') { start=[left-2,top+size.height/2]; end=[box.x+box.w+4,cy]; }
    // Use a fixed-size glyph near the target, never a stretched connector.
    const dx=end[0]-start[0], dy=end[1]-start[1];
    const length=Math.hypot(dx,dy)||1;
    const arrowX=end[0]-dx/length*11, arrowY=end[1]-dy/length*11;
    pointer.style.left=(arrowX-12)+'px';
    pointer.style.top=(arrowY-12)+'px';
    pointer.style.transform='rotate('+(Math.atan2(dy,dx)*180/Math.PI+90)+'deg)';
    overlay.dataset.target=selector;
    overlay.classList.add('positioned');
  }
  function schedule() { cancelAnimationFrame(frame); frame=requestAnimationFrame(position); }
  target.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
  position();
  const observer=new ResizeObserver(schedule);
  observer.observe(target); observer.observe(coach);
  window.addEventListener('resize',schedule);
  window.addEventListener('scroll',schedule,true);
  function keyboard(event) {
    if (event.key==='Escape') { event.preventDefault(); overlay.querySelector('[data-action="tour-skip"]').click(); }
    if (event.key!=='Tab') return;
    const buttons=[...overlay.querySelectorAll('button')];
    const index=buttons.indexOf(document.activeElement);
    if (event.shiftKey && index<=0) { event.preventDefault(); buttons.at(-1).focus(); }
    else if (!event.shiftKey && (index===buttons.length-1 || index<0)) { event.preventDefault(); buttons[0].focus(); }
  }
  overlay.addEventListener('keydown',keyboard);
  overlay.querySelector('[data-action="tour-next"]').focus({preventScroll:true});
  return () => {
    cancelAnimationFrame(frame); observer.disconnect();
    window.removeEventListener('resize',schedule); window.removeEventListener('scroll',schedule,true);
    overlay.removeEventListener('keydown',keyboard);
    background.forEach(el => { if (el) el.inert=false; });
  };
}
