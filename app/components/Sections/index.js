import React, { Component, PropTypes } from 'react'
import ReactDOM from 'react-dom'
import Ecology from "../Section"
import * as docgen from "react-docgen"
import contents from '../../utils/contents'
import utils from '../../../lib/utils'
import reactPropMeta from '../../../rcs-tmp/propsdoc'

class Sections extends Component {
  getContents () {
    let params = this.props.params;
    let data = {};

    if (params && params.query) {
      data = {
        query: params.query,
        keys: ['category', 'title', 'description', 'code']
      }
    } else if (params && params.category) {
      data = {
        query: params.component || params.category,
        keys: params.component ? ['title'] : ['category'],
        exact: true
      }
    }

    return contents.search(data)
  }

  render () {
    var componentsObj = contents.allComponents;
    return (
      <div>
        {this.getContents().map((Content, i) => {
          var displayName = Content.name ? Content.name : /^function\s+([\w\$]+)\s*\(/.exec( Content.toString() )[ 1 ];
          var readme = Content.styleguide && Content.styleguide.readme ? Content.styleguide.readme.default || Content.styleguide.readme: '';
          var docgenMeta = reactPropMeta[displayName];
          var scope = Object.assign({
            React,
            ReactDOM
          }, componentsObj);
          return (
            <section className='sg sg-section' key={i}>
               <Ecology
                  wrappedExample={Content.styleguide.wrappedExample}
                  overview={readme}
                  title={Content.styleguide.title}
                  description={Content.styleguide.description}
                  code={Content.styleguide.code}
                  source={docgenMeta}
                  scope={scope}
                  playgroundtheme="monokai"
                  idx={i}
                />
            </section>
          )
        })}
      </div>
    )
  }
}

Sections.displayName = 'SG.Sections';

export default Sections;
