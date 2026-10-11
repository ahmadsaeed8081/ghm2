import{aL as c,aF as f,aG as d,aE as u}from"./index-ClfCM5y8.js";const w=c`
  :host > wui-flex:first-child {
    height: 500px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
  }

  :host > wui-flex:first-child::-webkit-scrollbar {
    display: none;
  }
`;var p=function(n,t,i,l){var o=arguments.length,e=o<3?t:l===null?l=Object.getOwnPropertyDescriptor(t,i):l,r;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")e=Reflect.decorate(n,t,i,l);else for(var a=n.length-1;a>=0;a--)(r=n[a])&&(e=(o<3?r(e):o>3?r(t,i,e):r(t,i))||e);return o>3&&e&&Object.defineProperty(t,i,e),e};let s=class extends f{render(){return d`
      <wui-flex flexDirection="column" .padding=${["0","3","3","3"]} gap="3">
        <w3m-activity-list page="activity"></w3m-activity-list>
      </wui-flex>
    `}};s.styles=w;s=p([u("w3m-transactions-view")],s);export{s as W3mTransactionsView};
